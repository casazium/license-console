import { NextRequest, NextResponse } from 'next/server';
import { getSession, revokeAccountSessions, SESSION_COOKIE_NAME } from '@/lib/session';
import { isMultiTenant, isSameOrigin } from '@/lib/config';
import { getAccountEmail } from '@/lib/auth';
import { getNotificationProvider } from '@/lib/notifications';

export async function POST(request: NextRequest) {
  // Security review finding (third-party audit, R3-review-lows): this
  // route (and verify-email/resend's own identical addition) previously
  // relied solely on SameSite=Lax for CSRF protection, unlike login/
  // signup which already check Origin explicitly. SameSite=Lax treats
  // sibling subdomains as same-site, so if anything on a sibling of this
  // console's registrable domain were ever attacker-influenced (a
  // marketing subdomain, a takeoverable CNAME), this route becomes
  // forgeable - a forced logout, which under MULTI_TENANT revokes *all*
  // of the account's sessions via revokeAccountSessions() below, not
  // just the one the attacker's page could see. Costs one line, same
  // gate login/signup/forgot-password already use.
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 });
  }

  // Security review finding (fresh pre-deployment audit): this used to
  // only clear the browser's cookie - sessions are stateless 8h JWTs
  // (lib/session.ts's own header comment), so a copy of the token made
  // before logout (XSS, a shared/compromised machine, a proxy log) kept
  // verifying as valid for up to 8 more hours regardless. Reuses
  // revokeAccountSessions() (the same sessions_revoked_at watermark
  // password-reset already bumps) rather than inventing a second
  // mechanism - deliberately coarse (every session for the account, not
  // just this one device), the same accepted tradeoff that function's
  // own comment already documents. Self-hosted has no accounts row to
  // revoke (its single shared identity is ADMIN_UI_USERNAME, not a real
  // account id) - matches every other SaaS-only behavior in this repo
  // in being gated behind isMultiTenant(), not attempted and silently
  // no-op'd.
  // Operator notification (TASK_ACCOUNT_NOTIFICATIONS.md) - reads the
  // session unconditionally (both modes), not just under isMultiTenant()
  // as this route used to. Session revocation genuinely only applies to
  // SaaS (self-hosted has no accounts row to revoke), but a logout
  // notification is one of only two events self-hosted deployments ever
  // emit under this task - it must not be gated behind the same check.
  // Adversarial review verified this is safe to call unconditionally:
  // getSession() never throws (every failure path is caught inside it)
  // and a null return (no/expired/invalid cookie) doesn't block anything
  // below - cookie deletion proceeds either way.
  const session = await getSession();

  if (isMultiTenant() && session) {
    revokeAccountSessions(session.id);
  }

  if (session) {
    const logoutIdentity = session.mode === 'saas' ? (getAccountEmail(session.id) ?? session.id) : session.id;
    getNotificationProvider()
      .notify({ type: 'logout', email: logoutIdentity })
      .catch((err) => {
        console.error(`Failed to send logout notification for account ${session.id}:`, err);
      });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE_NAME);
  return response;
}
