import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { publicBaseUrl } from '@/lib/config';
import { hashOneTimeToken } from '@/lib/one-time-token';
import { getEmailProvider } from '@/lib/email';

/**
 * Confirmation-link target for two distinct flows, both sharing this
 * table/token shape (schema.sql's own comment on new_email explains
 * why): signup confirmation (the original use - row.new_email is NULL)
 * and account-settings email change (app/api/change-email/route.ts's
 * step 1 - row.new_email is the requested new address). A GET route,
 * not a form/fetch call, since this is what an email client actually
 * opens. No session is required or checked: the one-time token itself
 * is the credential, exactly like casazium/license's own
 * reissue-activation-token model (possession of the token is what's
 * being verified, not who's asking) - true for both flows here, an
 * email-change confirmation is proof of the NEW inbox, nothing more.
 *
 * Signup confirmation redirects to /dashboard regardless of outcome -
 * success or failure, invalid or expired token. The AppShellClient
 * banner (shown whenever the signed-in account's own email_verified_at
 * is still null) is the actual feedback mechanism: it disappears on
 * success, or keeps showing (with its own resend option) if this didn't
 * work. No separate one-time toast/query-param state to keep in sync
 * with that.
 *
 * Email-change confirmation has no equivalent always-on banner to fall
 * back on, so it redirects to /settings instead, carrying a query-param
 * outcome (emailChanged / emailChangeError) that page reads to show a
 * one-time Alert - the one place in this route where outcome actually
 * needs to reach the person clicking the link.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  // Same publicBaseUrl() fix as the emailed links this route is the
  // target of (security review finding H2) - request.nextUrl.origin is
  // wrong here too, even though the browser reached this GET at the
  // real public host: the redirect Location header this handler emits
  // would otherwise still point at the server's own resolved origin.
  const baseUrl = publicBaseUrl(request);
  const dashboardUrl = new URL('/dashboard', baseUrl);

  if (!token) {
    return NextResponse.redirect(dashboardUrl);
  }

  const db = getDb();
  const tokenHash = hashOneTimeToken(token);

  const row = db
    .prepare('SELECT account_id, expires_at, new_email FROM email_verification_tokens WHERE token_hash = ?')
    .get(tokenHash) as { account_id: string; expires_at: string; new_email: string | null } | undefined;

  // Every outcome below still redirects - an invalid, reused, or
  // expired link isn't distinguished from each other here.
  if (!row) {
    return NextResponse.redirect(dashboardUrl);
  }

  // One-time use regardless of outcome - a link that's already been
  // consumed, or has expired, shouldn't stay redeemable.
  db.prepare('DELETE FROM email_verification_tokens WHERE token_hash = ?').run(tokenHash);

  if (new Date(row.expires_at) < new Date()) {
    return NextResponse.redirect(row.new_email ? new URL('/settings?emailChangeError=1', baseUrl) : dashboardUrl);
  }

  if (row.new_email) {
    const settingsChangedUrl = new URL('/settings?emailChanged=1', baseUrl);
    const settingsErrorUrl = new URL('/settings?emailChangeError=1', baseUrl);

    const account = db.prepare('SELECT email FROM accounts WHERE id = ?').get(row.account_id) as
      | { email: string }
      | undefined;
    if (!account) {
      return NextResponse.redirect(settingsErrorUrl);
    }
    const oldEmail = account.email;

    try {
      // idx_accounts_email is the real guarantee here - the uniqueness
      // check in change-email/route.ts's own POST is only an early,
      // best-effort check against the same race every "reserve a name"
      // flow in this codebase has (that route's own comment). A second
      // account could have claimed row.new_email in the window between
      // that check and this redemption.
      db.prepare('UPDATE accounts SET email = ?, email_verified_at = CURRENT_TIMESTAMP WHERE id = ?').run(
        row.new_email,
        row.account_id
      );
    } catch (err) {
      console.error(`Failed to redeem email-change confirmation for account ${row.account_id}:`, err);
      return NextResponse.redirect(settingsErrorUrl);
    }

    db.prepare('DELETE FROM email_verification_tokens WHERE account_id = ?').run(row.account_id);

    // Best-effort notice to the OLD address (provider.ts's own comment
    // on why this exists) - doesn't block or fail the redirect either
    // way; the change already took effect above regardless of whether
    // this send succeeds.
    try {
      await getEmailProvider().sendEmailChangeNotice(oldEmail, row.new_email);
    } catch (err) {
      console.error(`Failed to send email-change notice to old address for account ${row.account_id}:`, err);
    }

    return NextResponse.redirect(settingsChangedUrl);
  }

  db.prepare('UPDATE accounts SET email_verified_at = CURRENT_TIMESTAMP WHERE id = ?').run(row.account_id);

  // Security review finding M4 (same pattern as reset-password's own
  // fix): invalidate any other outstanding verification token for this
  // account too, not just the one just used - e.g. a stale token from
  // before a "resend" request, still sitting in the table with time
  // left on its TTL.
  db.prepare('DELETE FROM email_verification_tokens WHERE account_id = ?').run(row.account_id);

  return NextResponse.redirect(dashboardUrl);
}
