import { NextRequest, NextResponse } from 'next/server';
import { isMultiTenant } from '@/lib/config';
import { getDb } from '@/lib/db';
import { getEmailProvider } from '@/lib/email';
import { generateOneTimeToken, hashOneTimeToken } from '@/lib/one-time-token';
import { checkLoginRateLimit, recordFailedLoginAttempt, getClientKey } from '@/lib/login-rate-limit';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
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
  const clientKey = `forgot-password:${getClientKey(request)}`;
  const rateLimit = checkLoginRateLimit(clientKey);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } }
    );
  }
  recordFailedLoginAttempt(clientKey);

  if (!isMultiTenant()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const email = body?.email;

  const genericResponse = () =>
    NextResponse.json({ ok: true, message: 'If that email is registered, a reset link has been sent.' });

  if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
    return genericResponse();
  }

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

    const resetUrl = new URL(`/reset-password?token=${resetToken}`, request.nextUrl.origin).toString();
    await getEmailProvider().sendPasswordReset(email, resetUrl);
  } catch (err) {
    // Logged, not surfaced - genericResponse() below still returns the
    // same success shape either way, same reasoning as signup's own
    // best-effort email send.
    console.error(`Failed to send password reset email for account ${account.id}:`, err);
  }

  return genericResponse();
}
