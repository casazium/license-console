import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { hashPassword } from '@/lib/password';
import { hashOneTimeToken } from '@/lib/one-time-token';
import {
  createSessionToken,
  revokeAccountSessions,
  sessionCookieOptions,
  SESSION_COOKIE_NAME,
} from '@/lib/session';
import { checkLoginRateLimit, recordFailedLoginAttempt, getClientKey } from '@/lib/login-rate-limit';

const MIN_PASSWORD_LENGTH = 8;

/**
 * Password-reset confirmation - no session required or checked, the
 * token itself is the credential (same model as /api/verify-email).
 * Unlike that route, this one is a POST from a real form, not a link
 * an email client opens directly, since it needs a new password value
 * - a GET link can't carry that safely.
 *
 * On success: revokes every existing session for the account
 * (lib/session.ts's own revokeAccountSessions - built for exactly this
 * trigger, per its header comment) before issuing a fresh one for the
 * browser completing the reset. A stolen or leaked session shouldn't
 * survive a legitimate password reset; the person who just proved they
 * control the account's email gets signed in fresh, everyone else (any
 * other still-open session) is signed out.
 */
export async function POST(request: NextRequest) {
  // IP-keyed, not account-keyed - the token's own 128 bits of entropy
  // already makes brute-forcing infeasible; this is defense-in-depth
  // against a caller hammering the endpoint, not the real protection.
  const clientKey = `reset-password:${getClientKey(request)}`;
  const rateLimit = checkLoginRateLimit(clientKey);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } }
    );
  }

  const body = await request.json().catch(() => null);
  const token = body?.token;
  const password = body?.password;

  if (typeof token !== 'string' || token.length === 0) {
    recordFailedLoginAttempt(clientKey);
    return NextResponse.json({ error: 'Invalid or expired reset link' }, { status: 400 });
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    recordFailedLoginAttempt(clientKey);
    return NextResponse.json(
      { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` },
      { status: 400 }
    );
  }

  const db = getDb();
  const tokenHash = hashOneTimeToken(token);

  const row = db
    .prepare('SELECT account_id, expires_at FROM password_reset_tokens WHERE token_hash = ?')
    .get(tokenHash) as { account_id: string; expires_at: string } | undefined;

  // One-time use regardless of outcome, same as /api/verify-email - a
  // reset link that's already been consumed, or has expired, shouldn't
  // stay redeemable.
  if (row) {
    db.prepare('DELETE FROM password_reset_tokens WHERE token_hash = ?').run(tokenHash);
  }

  if (!row || new Date(row.expires_at) < new Date()) {
    recordFailedLoginAttempt(clientKey);
    return NextResponse.json({ error: 'Invalid or expired reset link' }, { status: 400 });
  }

  const passwordHash = await hashPassword(password);
  db.prepare('UPDATE accounts SET password_hash = ? WHERE id = ?').run(passwordHash, row.account_id);
  revokeAccountSessions(row.account_id);

  const sessionToken = await createSessionToken({ id: row.account_id, role: 'admin' });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, sessionToken, sessionCookieOptions);
  return response;
}
