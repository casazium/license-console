import { NextRequest, NextResponse } from 'next/server';
import { verifyCredentials } from '@/lib/auth';
import { createSessionToken, sessionCookieOptions, SESSION_COOKIE_NAME } from '@/lib/session';
import { checkLoginRateLimit, recordFailedLoginAttempt, getClientKey } from '@/lib/login-rate-limit';
import { isMultiTenant } from '@/lib/config';
import { getTenantApiKey, getAccountTenantId, markTenantRevoked } from '@/lib/tenant-context';
import { getBillingStatus } from '@/lib/license-client';
import { isTenantRejected } from '@/lib/errors';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const username = body?.username;
  const password = body?.password;

  // Keyed by identifier+IP, not IP alone (security review finding H1):
  // an IP-only bucket meant an attacker could reset it at will by
  // logging into any account they control (trivial under MULTI_TENANT
  // self-service signup), and separately let one attacker's failures
  // lock out every legitimate user sharing that IP/proxy. Computed
  // before validating the body shape so a malformed/missing-username
  // request still gets *some* rate limiting (IP alone, via
  // getClientKey's undefined-identifier fallback) rather than none.
  const clientKey = getClientKey(request, typeof username === 'string' ? username : undefined);

  const rateLimit = checkLoginRateLimit(clientKey);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many login attempts. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    );
  }

  if (typeof username !== 'string' || typeof password !== 'string') {
    return NextResponse.json({ error: 'Username and password are required' }, { status: 400 });
  }

  const identity = await verifyCredentials(username, password);
  if (!identity) {
    recordFailedLoginAttempt(clientKey);
    return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
  }

  // "Trigger 2" login-time probe (lib/tenant-context.ts's own
  // markIfTenantRejected doc comment has the full design record). A
  // fresh login always produces a token issued *after*
  // accounts.tenant_revoked_at would have been set by an earlier
  // reactive detection - lib/session.ts's own persistent-gate check
  // still catches that case regardless of iat, but a tenant revoked
  // moments ago, with no reactive detection having fired yet, would
  // otherwise sail through on a first login attempt with no check at
  // all. One extra call to the license server's own tenant-scoped
  // GET /billing/status - already exists, no new endpoint needed - which
  // 403s exactly like every other tenant-scoped route once the tenant's
  // status isn't 'active'.
  //
  // Deliberately fails OPEN on anything other than that specific,
  // authoritative rejection: a network error, timeout, 5xx, or 429 here
  // must not block login for everyone every time the license server
  // hiccups - that would turn a transient backend issue into a
  // console-wide outage. Only isTenantRejected(err) actually blocks.
  if (isMultiTenant()) {
    try {
      const tenantApiKey = getTenantApiKey(identity.id);
      await getBillingStatus(tenantApiKey);
    } catch (err) {
      if (isTenantRejected(err)) {
        const tenantId = getAccountTenantId(identity.id);
        if (tenantId) {
          markTenantRevoked(tenantId);
        }
        recordFailedLoginAttempt(clientKey);
        return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
      }
      // Any other error: fall through and let login proceed - see the
      // fail-open note above.
    }
  }

  // Deliberately NOT clearing clientKey's bucket here (security review
  // finding H1-A): doing so let an attacker reset their own failed-
  // attempt count at will by logging into any account they control -
  // trivial under self-service signup - turning the 5-attempt limit
  // into an unbounded guessing loop in cycles of 4. Leftover failed
  // attempts simply age out of the fixed window as normal.
  const token = await createSessionToken(identity);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions);
  return response;
}
