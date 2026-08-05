import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireSession } from '@/lib/session';
import { generateEmailVerificationToken, hashEmailVerificationToken } from '@/lib/email-verification-token';
import { getEmailProvider } from '@/lib/email';
import {
  checkLoginRateLimit,
  recordFailedLoginAttempt,
  getClientKey,
} from '@/lib/login-rate-limit';

const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Resend affordance for AppShellClient's "verify your email" banner.
 * Requires an active session (this repo's Server Actions/Route Handlers
 * boundary - lib/session.ts's own header comment - not proxy.ts, which
 * doesn't run for actions/most fetches from client components the same
 * way page navigation does).
 */
export async function POST(request: NextRequest) {
  const session = await requireSession().catch(() => null);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Reuses the login rate-limiter's generic bucket machinery, keyed by
  // account rather than IP - a resend button is a logged-in action, not
  // an anonymous one, so the account itself is the right key (an
  // attacker who wanted to spam someone's inbox would need that
  // person's own active session to hit this at all).
  const clientKey = `verify-email-resend:${session.id}`;
  const rateLimit = checkLoginRateLimit(clientKey);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } }
    );
  }
  recordFailedLoginAttempt(clientKey);

  const db = getDb();
  const account = db.prepare('SELECT email, email_verified_at FROM accounts WHERE id = ?').get(session.id) as
    | { email: string; email_verified_at: string | null }
    | undefined;

  if (!account) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (account.email_verified_at) {
    return NextResponse.json({ ok: true });
  }

  try {
    const verificationToken = generateEmailVerificationToken();
    const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS).toISOString();
    db.prepare(
      `INSERT INTO email_verification_tokens (token_hash, account_id, expires_at) VALUES (?, ?, ?)`
    ).run(hashEmailVerificationToken(verificationToken), session.id, expiresAt);

    const confirmUrl = new URL(`/api/verify-email?token=${verificationToken}`, request.nextUrl.origin).toString();
    await getEmailProvider().sendSignupConfirmation(account.email, confirmUrl);
  } catch (err) {
    console.error(`Failed to resend signup confirmation email for account ${session.id}:`, err);
    return NextResponse.json({ error: 'Failed to resend confirmation email' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
