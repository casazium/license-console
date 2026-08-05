import { NextRequest, NextResponse } from 'next/server';
import { verifyCredentials } from '@/lib/auth';
import { createSessionToken, sessionCookieOptions, SESSION_COOKIE_NAME } from '@/lib/session';
import { checkLoginRateLimit, recordFailedLoginAttempt, clearLoginRateLimit, getClientKey } from '@/lib/login-rate-limit';
import { isMultiTenant } from '@/lib/config';
import { getTenantApiKey, getAccountTenantId, markTenantRevoked } from '@/lib/tenant-context';
import { getBillingStatus } from '@/lib/license-client';
import { isTenantRejected } from '@/lib/errors';

export async function POST(request: NextRequest) {
  const clientKey = getClientKey(request);

  const rateLimit = checkLoginRateLimit(clientKey);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many login attempts. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    );
  }

  const body = await request.json().catch(() => null);
  const username = body?.username;
  const password = body?.password;

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

  clearLoginRateLimit(clientKey);
  const token = await createSessionToken(identity);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions);
  return response;
}
