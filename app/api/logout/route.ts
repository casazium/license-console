import { NextResponse } from 'next/server';
import { getSession, revokeAccountSessions, SESSION_COOKIE_NAME } from '@/lib/session';
import { isMultiTenant } from '@/lib/config';

export async function POST() {
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
  if (isMultiTenant()) {
    const session = await getSession();
    if (session) {
      revokeAccountSessions(session.id);
    }
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE_NAME);
  return response;
}
