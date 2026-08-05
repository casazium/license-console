import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { isMultiTenant } from '@/lib/config';
import { getDb } from '@/lib/db';
import { hashPassword } from '@/lib/password';
import { encrypt } from '@/lib/crypto';
import { createSessionToken, sessionCookieOptions, SESSION_COOKIE_NAME } from '@/lib/session';
import {
  checkLoginRateLimit,
  recordFailedLoginAttempt,
  clearLoginRateLimit,
  getClientKey,
} from '@/lib/login-rate-limit';
import { generateEmailVerificationToken, hashEmailVerificationToken } from '@/lib/email-verification-token';
import { getEmailProvider } from '@/lib/email';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

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
  // Reuses the login rate-limiter's generic bucket machinery under a
  // distinct key prefix, not a separate limiter - same in-memory,
  // single-replica caveat as login (see lib/login-rate-limit.ts's own
  // header comment; SaaS-B1d is the follow-up for SaaS hosting).
  const clientKey = `signup:${getClientKey(request)}`;
  const rateLimit = checkLoginRateLimit(clientKey);
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
  const email = body?.email;
  const password = body?.password;
  const tenantName = body?.tenantName;

  if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
    recordFailedLoginAttempt(clientKey);
    return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    recordFailedLoginAttempt(clientKey);
    return NextResponse.json(
      { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` },
      { status: 400 }
    );
  }
  if (typeof tenantName !== 'string' || tenantName.trim().length === 0) {
    recordFailedLoginAttempt(clientKey);
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
    recordFailedLoginAttempt(clientKey);
    // Generic message deliberately - don't confirm an email is already
    // registered to an unauthenticated caller.
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

  clearLoginRateLimit(clientKey);

  // Signup confirmation email - best-effort, not on the request's
  // success path. A tenant/account already exists at this point (the
  // insert above committed); failing the whole signup because the email
  // send failed would strand them with a provisioned tenant and no way
  // back in, worse than just landing them signed-in with an unverified
  // account they can request a new link for later.
  try {
    const verificationToken = generateEmailVerificationToken();
    const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS).toISOString();
    db.prepare(
      `INSERT INTO email_verification_tokens (token_hash, account_id, expires_at) VALUES (?, ?, ?)`
    ).run(hashEmailVerificationToken(verificationToken), accountId, expiresAt);

    const confirmUrl = new URL(`/api/verify-email?token=${verificationToken}`, request.nextUrl.origin).toString();
    await getEmailProvider().sendSignupConfirmation(email, confirmUrl);
  } catch (err) {
    console.error(`Failed to send signup confirmation email for account ${accountId}:`, err);
  }

  const token = await createSessionToken({ id: accountId, role: 'admin' });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions);
  return response;
}
