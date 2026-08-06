import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { publicBaseUrl } from '@/lib/config';
import { hashOneTimeToken } from '@/lib/one-time-token';

/**
 * Signup confirmation link target - a GET route, not a form/fetch call,
 * since this is what an email client actually opens. No session is
 * required or checked: the one-time token itself is the credential,
 * exactly like casazium/license's own reissue-activation-token model
 * (possession of the token is what's being verified, not who's asking).
 *
 * Always redirects to /dashboard regardless of outcome - success or
 * failure, invalid or expired token. The AppShellClient banner (shown
 * whenever the signed-in account's own email_verified_at is still null)
 * is the actual feedback mechanism: it disappears on success, or keeps
 * showing (with its own resend option) if this didn't work. No separate
 * one-time toast/query-param state to keep in sync with that.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  // Same publicBaseUrl() fix as the emailed links this route is the
  // target of (security review finding H2) - request.nextUrl.origin is
  // wrong here too, even though the browser reached this GET at the
  // real public host: the redirect Location header this handler emits
  // would otherwise still point at the server's own resolved origin.
  const dashboardUrl = new URL('/dashboard', publicBaseUrl(request));

  if (!token) {
    return NextResponse.redirect(dashboardUrl);
  }

  const db = getDb();
  const tokenHash = hashOneTimeToken(token);

  const row = db
    .prepare('SELECT account_id, expires_at FROM email_verification_tokens WHERE token_hash = ?')
    .get(tokenHash) as { account_id: string; expires_at: string } | undefined;

  // Every outcome below still redirects to /dashboard - an invalid,
  // reused, or expired link isn't distinguished from each other here;
  // the banner not disappearing already says "that didn't work."
  if (!row) {
    return NextResponse.redirect(dashboardUrl);
  }

  // One-time use regardless of outcome - a link that's already been
  // consumed, or has expired, shouldn't stay redeemable.
  db.prepare('DELETE FROM email_verification_tokens WHERE token_hash = ?').run(tokenHash);

  if (new Date(row.expires_at) < new Date()) {
    return NextResponse.redirect(dashboardUrl);
  }

  db.prepare('UPDATE accounts SET email_verified_at = CURRENT_TIMESTAMP WHERE id = ?').run(row.account_id);

  return NextResponse.redirect(dashboardUrl);
}
