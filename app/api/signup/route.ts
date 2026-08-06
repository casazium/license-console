import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { isMultiTenant, publicBaseUrl, isSameOrigin } from '@/lib/config';
import { getDb } from '@/lib/db';
import { hashPassword } from '@/lib/password';
import { encrypt } from '@/lib/crypto';
import { createSessionToken, sessionCookieOptions, SESSION_COOKIE_NAME } from '@/lib/session';
import { checkAndReserveAttempt, getClientKey } from '@/lib/login-rate-limit';
import { normalizeEmail } from '@/lib/auth';
import { generateOneTimeToken, hashOneTimeToken } from '@/lib/one-time-token';
import { getEmailProvider } from '@/lib/email';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
// Security review finding (fresh pre-deployment audit): none of this
// route's three string inputs had an upper bound - an attacker could
// submit an arbitrarily large email/password/tenantName. Only 3
// attempts get through per window (SIGNUP_MAX_ATTEMPTS above), so this
// isn't an open-ended DoS, but each successful reservation still runs
// the full cost regex validation, hashPassword()'s scrypt pass (whose
// cost scales with input size, not just the fixed N/r/p above), a real
// outbound tenant-provisioning call, and a DB insert - no reason to let
// any of them run against megabytes of input. MAX_EMAIL_LENGTH matches
// RFC 5321's own mailbox length limit; the other two are generous, not
// tight, caps.
const MAX_EMAIL_LENGTH = 254;
const MAX_PASSWORD_LENGTH = 256;
const MAX_TENANT_NAME_LENGTH = 200;
const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

// Lower than login's default 5/window (security review finding H3): a
// successful signup here provisions a real tenant on casazium/license
// (server-to-server call, scrypt hash, a real outbound email) - a much
// more expensive operation per attempt than a login password check, and
// worth a tighter bound even though both share the same underlying
// per-IP window.
const SIGNUP_MAX_ATTEMPTS = 3;

/**
 * SaaS-B1b. Self-service signup: provisions a new tenant on
 * casazium/license (server-to-server, using this console's own
 * LICENSE_ADMIN_API_KEY - the signing-up human never sees or holds it,
 * per SaaS-A0's own note that this is exactly how that key was meant to
 * be used here) and creates the tenant's first account together.
 * Multiple accounts per tenant (team invites) is schema-compatible but
 * not built here - out of this task's scope.
 */
export async function POST(request: NextRequest) {
  // Security review finding, fresh pre-deployment audit: rejected
  // before touching the rate limiter or parsing the body - see
  // lib/config.ts's isSameOrigin() and login/route.ts's identical check
  // for the full exploit and reasoning.
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 });
  }

  // Reuses the login rate-limiter's generic bucket machinery under a
  // distinct key prefix, not a separate limiter - same in-memory,
  // single-replica caveat as login (see lib/login-rate-limit.ts's own
  // header comment; SaaS-B1d is the follow-up for SaaS hosting).
  // Security review finding, fresh pre-deployment audit: reserved
  // atomically up front, not checked-then-later-recorded - the old
  // two-step API left a window between this check and the awaited
  // tenant-provisioning fetch below for concurrent requests to all pass
  // at the same count (confirmed: 25 concurrent signups let 14 through
  // against a limit of 3, each provisioning a real tenant). Every
  // outcome below - validation failure, duplicate email, provisioning
  // failure, or success - counts once, already reserved here; none of
  // them call anything further to record it.
  const clientKey = `signup:${getClientKey(request)}`;
  const rateLimit = checkAndReserveAttempt(clientKey, SIGNUP_MAX_ATTEMPTS);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many signup attempts. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } }
    );
  }

  // Self-hosted has no accounts concept at all - fail loud rather than a
  // reachable-but-meaningless endpoint, same posture as casazium/license's
  // own create-tenant.js under !isMultiTenant().
  if (!isMultiTenant()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const rawEmail = body?.email;
  const password = body?.password;
  const tenantName = body?.tenantName;

  if (typeof rawEmail !== 'string' || rawEmail.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(rawEmail)) {
    return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
  }
  // Security review finding (fresh pre-deployment audit): normalized
  // once here and used for every lookup/insert/email-send below - see
  // lib/auth.ts's normalizeEmail() for the full reasoning (case-
  // sensitive lookups meant 'Alice@x.com' and 'alice@x.com' were two
  // different accounts on the same real mailbox).
  const email = normalizeEmail(rawEmail);
  if (
    typeof password !== 'string' ||
    password.length < MIN_PASSWORD_LENGTH ||
    password.length > MAX_PASSWORD_LENGTH
  ) {
    return NextResponse.json(
      { error: `Password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters` },
      { status: 400 }
    );
  }
  if (
    typeof tenantName !== 'string' ||
    tenantName.trim().length === 0 ||
    tenantName.length > MAX_TENANT_NAME_LENGTH
  ) {
    return NextResponse.json({ error: 'Company/organization name is required' }, { status: 400 });
  }

  const db = getDb();

  // An early check, not the actual correctness guarantee - idx_accounts_email
  // (schema.sql) is the real one, since a concurrent signup could still
  // race between this SELECT and the INSERT below (there's a real await -
  // the tenant-provisioning call - in between). This just avoids
  // needlessly provisioning a tenant for an obviously-taken email in the
  // common case.
  const existing = db.prepare('SELECT id FROM accounts WHERE email = ?').get(email);
  if (existing) {
    // Security review finding M3: the message is generic, but the 409
    // status code itself still confirms the email is registered to an
    // unauthenticated caller - a real, but accepted, tradeoff. Unlike
    // forgot-password (which has no legitimate reason to ever confirm
    // or deny registration), telling someone at signup time "this email
    // is already registered, try logging in instead" is the ordinary,
    // expected UX almost every product uses - hiding it here would
    // trade a minor enumeration signal for a confusing signup flow for
    // the common, legitimate case of someone re-signing-up with their
    // own account. Recorded explicitly rather than left as a comment
    // claiming full anonymity that the status code doesn't back up.
    return NextResponse.json({ error: 'Unable to create account' }, { status: 409 });
  }

  const licenseApiUrl = process.env.LICENSE_API_URL;
  const licenseAdminApiKey = process.env.LICENSE_ADMIN_API_KEY;
  if (!licenseApiUrl || !licenseAdminApiKey) {
    // MULTI_TENANT=true with no real backend configured is a
    // misconfiguration, not something to silently degrade from - there's
    // no standalone/mock equivalent for provisioning a real tenant.
    console.error(
      'Signup attempted with MULTI_TENANT=true but LICENSE_API_URL/LICENSE_ADMIN_API_KEY is unset'
    );
    return NextResponse.json({ error: 'Signup is not available right now' }, { status: 500 });
  }

  let tenant: { id: string; name: string; apiKey: string };
  try {
    const provisionResponse = await fetch(`${licenseApiUrl}/admin/tenants`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${licenseAdminApiKey}`,
      },
      body: JSON.stringify({ name: tenantName.trim() }),
    });
    if (!provisionResponse.ok) {
      throw new Error(`Tenant provisioning responded with status ${provisionResponse.status}`);
    }
    tenant = await provisionResponse.json();
  } catch (err) {
    console.error('Tenant provisioning failed during signup:', err);
    return NextResponse.json({ error: 'Unable to create account' }, { status: 500 });
  }

  const passwordHash = await hashPassword(password);
  const encryptedApiKey = encrypt(tenant.apiKey);
  const accountId = crypto.randomUUID();

  try {
    db.prepare(
      `INSERT INTO accounts (id, email, password_hash, tenant_id, tenant_name, tenant_api_key_encrypted)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(accountId, email, passwordHash, tenant.id, tenantName.trim(), encryptedApiKey);
  } catch (err) {
    // The tenant above was already provisioned on casazium/license and is
    // now orphaned (no local account references it) - most likely cause is
    // the idx_accounts_email race described above. Not auto-cleaned-up
    // here (a revoke call in an already-failing path has its own failure
    // modes, compounding rather than fixing the problem) - logged clearly
    // so an operator can find and revoke it via POST /admin/tenants/:id/revoke.
    console.error(
      `Account insert failed after provisioning tenant ${tenant.id} during signup - tenant is now orphaned:`,
      err
    );
    return NextResponse.json({ error: 'Unable to create account' }, { status: 409 });
  }

  // Signup confirmation email - best-effort, not on the request's
  // success path. A tenant/account already exists at this point (the
  // insert above committed); failing the whole signup because the email
  // send failed would strand them with a provisioned tenant and no way
  // back in, worse than just landing them signed-in with an unverified
  // account they can request a new link for later.
  try {
    const verificationToken = generateOneTimeToken();
    const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS).toISOString();
    db.prepare(
      `INSERT INTO email_verification_tokens (token_hash, account_id, expires_at) VALUES (?, ?, ?)`
    ).run(hashOneTimeToken(verificationToken), accountId, expiresAt);

    const confirmUrl = new URL(`/api/verify-email?token=${verificationToken}`, publicBaseUrl(request)).toString();
    await getEmailProvider().sendSignupConfirmation(email, confirmUrl);
  } catch (err) {
    console.error(`Failed to send signup confirmation email for account ${accountId}:`, err);
  }

  const token = await createSessionToken({ id: accountId, role: 'admin', mode: 'saas' });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions);
  return response;
}
