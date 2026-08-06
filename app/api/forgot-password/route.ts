import { NextRequest, NextResponse } from 'next/server';
import { isMultiTenant, publicBaseUrl, isSameOrigin } from '@/lib/config';
import { getDb } from '@/lib/db';
import { getEmailProvider } from '@/lib/email';
import { generateOneTimeToken, hashOneTimeToken } from '@/lib/one-time-token';
import { checkAndReserveAttempt, getClientKey } from '@/lib/login-rate-limit';
import { normalizeEmail } from '@/lib/auth';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Security review finding (fresh pre-deployment audit): matches
// signup/route.ts's identical cap and reasoning (RFC 5321's own mailbox
// length limit).
const MAX_EMAIL_LENGTH = 254;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

/**
 * Password-reset request - deliberately public (no session), since the
 * whole point is recovering an account you're locked out of. Keyed by
 * IP, not by account (same reasoning as signup's rate limiter): keying
 * by account would mean the rate-limit response itself leaks whether an
 * email is registered, which the response body already goes out of its
 * way not to.
 *
 * Always returns the same generic success response regardless of
 * whether the email matches a real account - the one place this
 * deliberately differs from signup's own "Unable to create account"
 * 409, which does implicitly confirm an email is taken. Password reset
 * has no legitimate reason to ever confirm or deny that to an
 * unauthenticated caller, so it doesn't.
 */
export async function POST(request: NextRequest) {
  // Security review finding (third-party audit, R3-review-lows): unlike
  // login/signup, this route had no Origin check at all - confirmed
  // live, a cross-origin POST with Origin: https://evil.example still
  // returned the real 200 success response and sent the real reset
  // email. Impact is bounded (an attacker could just POST directly from
  // their own server instead of routing through a victim's browser -
  // there's no session/ambient credential here to steal), but a
  // cross-origin page could still burn the *victim's own* IP rate-limit
  // bucket and mail-bomb arbitrary addresses through visitors' browsers
  // without their knowledge. Same isSameOrigin() gate login/signup
  // already use, in the same first-line position.
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 });
  }

  // checkAndReserveAttempt checks and counts in one atomic call - this
  // route already had no await between the old check and record calls,
  // so this is a like-for-like swap (consistency with the other routes
  // that did have a real race - see signup/route.ts's comment), not a
  // behavior change here.
  const clientKey = `forgot-password:${getClientKey(request)}`;
  const rateLimit = checkAndReserveAttempt(clientKey);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } }
    );
  }

  if (!isMultiTenant()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const rawEmail = body?.email;

  const genericResponse = () =>
    NextResponse.json({ ok: true, message: 'If that email is registered, a reset link has been sent.' });

  if (typeof rawEmail !== 'string' || rawEmail.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(rawEmail)) {
    return genericResponse();
  }
  // Security review finding (fresh pre-deployment audit): see
  // signup/route.ts's identical comment - without this, a real account
  // registered as e.g. 'Bob@corp.com' got the generic "success" message
  // here for 'bob@corp.com' too, but silently never received an email,
  // since this SELECT missed it.
  const email = normalizeEmail(rawEmail);

  const db = getDb();
  const account = db.prepare('SELECT id FROM accounts WHERE email = ?').get(email) as { id: string } | undefined;

  if (!account) {
    return genericResponse();
  }

  try {
    const resetToken = generateOneTimeToken();
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();
    db.prepare(
      `INSERT INTO password_reset_tokens (token_hash, account_id, expires_at) VALUES (?, ?, ?)`
    ).run(hashOneTimeToken(resetToken), account.id, expiresAt);

    const resetUrl = new URL(`/reset-password?token=${resetToken}`, publicBaseUrl(request)).toString();
    // Deliberately not awaited (security review finding M2): this
    // route's own docblock claims the response is identical regardless
    // of whether the email is registered, but awaiting a real outbound
    // send here - only reachable when an account actually exists -
    // made the response *latency* a reliable account-existence oracle
    // instead. Under EMAIL_PROVIDER=stub the delta was small; under
    // EMAIL_PROVIDER=resend (production) it's a real network round trip
    // to api.resend.com, hundreds of ms, paid only for real accounts.
    // Firing without awaiting removes that gap - genericResponse()
    // below returns before this settles either way.
    getEmailProvider()
      .sendPasswordReset(email, resetUrl)
      .catch((err) => {
        console.error(`Failed to send password reset email for account ${account.id}:`, err);
      });
  } catch (err) {
    console.error(`Failed to prepare password reset for account ${account.id}:`, err);
  }

  return genericResponse();
}
