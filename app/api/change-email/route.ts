import { NextRequest, NextResponse } from 'next/server';
import { isMultiTenant, publicBaseUrl, isSameOrigin } from '@/lib/config';
import { getDb } from '@/lib/db';
import { normalizeEmail, verifyAccountPassword } from '@/lib/auth';
import { requireSession } from '@/lib/session';
import { generateOneTimeToken, hashOneTimeToken } from '@/lib/one-time-token';
import { getEmailProvider } from '@/lib/email';
import { checkAndReserveAttempt } from '@/lib/login-rate-limit';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Same cap and reasoning as signup/route.ts's identical constant -
// RFC 5321's own mailbox length limit.
const MAX_EMAIL_LENGTH = 254;
// Same TTL as signup confirmation (VERIFICATION_TOKEN_TTL_MS across this
// repo's other flows) - this token only ever changes an email address,
// never a password, and is only redeemable by whoever controls the new
// inbox, so it doesn't need password-reset's tighter 1h window.
const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Step 1 of account-settings email change (BETA_LAUNCH_STATUS.md §4).
 * Doesn't touch accounts.email itself - sends a confirmation link to
 * the REQUESTED new address, and only /api/verify-email's GET handler
 * (step 2, triggered by clicking that link) actually applies the
 * change. Two steps, not an immediate swap, for the same reason every
 * "change your email" flow works this way: an immediate change on a
 * typo'd address would lock the real owner out with no way back in
 * (forgot-password emails whatever's currently on file), and there'd
 * be no proof the requester actually controls the new mailbox at all.
 *
 * A Route Handler, not a Server Action, matching every other
 * link-emailing flow in this repo (signup, forgot-password,
 * verify-email/resend) - publicBaseUrl() needs a real request object
 * to build the confirmation URL from (see that function's own comment
 * on why request.nextUrl.origin, not a Server Action's own headers(),
 * is what's safe to trust here), and Server Actions don't have one.
 */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 });
  }

  const session = await requireSession().catch(() => null);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Defense in depth - the Settings UI this route backs only renders
  // under MULTI_TENANT with a resolved tenant (see the Settings page),
  // and self-hosted's single shared admin login has no accounts row for
  // any of this to operate on.
  if (!isMultiTenant() || !session.tenantId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Account-keyed, same reasoning as verify-email/resend's identical
  // rate limit - this is a logged-in action, not an anonymous one.
  const clientKey = `change-email:${session.id}`;
  const rateLimit = checkAndReserveAttempt(clientKey);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } }
    );
  }

  const body = await request.json().catch(() => null);
  const password = body?.password;
  const rawNewEmail = body?.newEmail;

  if (typeof password !== 'string' || password.length === 0) {
    return NextResponse.json({ error: 'Password is required' }, { status: 400 });
  }
  if (typeof rawNewEmail !== 'string' || rawNewEmail.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(rawNewEmail)) {
    return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
  }

  const passwordOk = await verifyAccountPassword(session.id, password);
  if (!passwordOk) {
    return NextResponse.json({ error: 'Incorrect password' }, { status: 401 });
  }

  const newEmail = normalizeEmail(rawNewEmail);
  const db = getDb();

  const currentAccount = db.prepare('SELECT email FROM accounts WHERE id = ?').get(session.id) as
    | { email: string }
    | undefined;
  if (!currentAccount) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (newEmail === currentAccount.email) {
    return NextResponse.json({ error: "That's already your email address" }, { status: 400 });
  }

  // Same early-check-not-the-real-guarantee caveat as signup/route.ts's
  // identical check - idx_accounts_email is what actually enforces this;
  // a concurrent request could still race between here and the UPDATE
  // in verify-email/route.ts's redemption step, which is wrapped in its
  // own try/catch for exactly that reason.
  const existing = db.prepare('SELECT id FROM accounts WHERE email = ?').get(newEmail);
  if (existing) {
    // Generic message, same accepted enumeration tradeoff signup/route.ts
    // documents for its own identical check - this is an authenticated
    // action, not an anonymous probe, but still shouldn't spell out
    // "that email belongs to a different account" outright.
    return NextResponse.json({ error: 'Unable to change email' }, { status: 409 });
  }

  try {
    const token = generateOneTimeToken();
    const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS).toISOString();
    db.prepare(
      `INSERT INTO email_verification_tokens (token_hash, account_id, expires_at, new_email) VALUES (?, ?, ?, ?)`
    ).run(hashOneTimeToken(token), session.id, expiresAt, newEmail);

    const confirmUrl = new URL(`/api/verify-email?token=${token}`, publicBaseUrl(request)).toString();
    await getEmailProvider().sendEmailChangeConfirmation(newEmail, confirmUrl);
  } catch (err) {
    console.error(`Failed to send email-change confirmation for account ${session.id}:`, err);
    return NextResponse.json({ error: 'Failed to send confirmation email' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
