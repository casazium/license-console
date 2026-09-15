import { NextRequest, NextResponse } from 'next/server';
import { verifyCredentials, getAccountEmail } from '@/lib/auth';
import { getNotificationProvider } from '@/lib/notifications';
import { createSessionToken, sessionCookieOptions, SESSION_COOKIE_NAME } from '@/lib/session';
import { checkAndReserveAttempt, refundAttempt, getClientKey, getAccountOnlyKey } from '@/lib/login-rate-limit';
import { isMultiTenant, isSameOrigin } from '@/lib/config';
import { getTenantApiKey, getAccountTenantId, markTenantRevoked, clearTenantRevoked } from '@/lib/tenant-context';
import { getBillingStatus } from '@/lib/license-client';
import { isTenantRejected } from '@/lib/errors';

// Security review finding (fresh pre-deployment audit): matches
// signup/route.ts's identical caps and reasoning - neither `username`
// nor `password` had an upper bound, and verifyCredentials() runs a
// scrypt pass under MULTI_TENANT whose cost scales with input size.
const MAX_USERNAME_LENGTH = 254;
const MAX_PASSWORD_LENGTH = 256;

export async function POST(request: NextRequest) {
  // Security review finding, fresh pre-deployment audit: rejected
  // before touching the rate limiter or parsing the body - see
  // lib/config.ts's isSameOrigin() for the full exploit and reasoning
  // (a cross-site request was previously able to log a victim's
  // browser into an attacker-controlled tenant).
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 });
  }

  // Security review finding (third-party audit, R3-CONSOLE-M1): this
  // used to buffer and JSON-parse the full request body BEFORE any rate
  // limiting ran at all - confirmed live, an 8MB body containing valid
  // credentials returned a real 200 with a session cookie, proving the
  // full oversized body was buffered and parsed at zero rate-limit cost
  // to the caller. The per-IP bucket below needs no request body at all
  // (it's keyed purely on IP), so it now runs first, before
  // request.json() - only requests that already clear it ever pay the
  // parse cost. The per-account bucket further down still has to run
  // after parsing (it's keyed on the submitted username, which doesn't
  // exist yet), which is unavoidable and unchanged from before.
  //
  // Second, looser bucket keyed by IP alone (security review finding,
  // fresh pre-deployment audit): closes unbounded password-spraying
  // across many *different* accounts from one IP - confirmed: 8
  // sequential logins with 8 distinct usernames from one IP, never a
  // 429. A much higher threshold than the per-account one below, so it
  // only ever fires on genuine spraying, not a real user mistyping
  // their own password a few times.
  const perIpKey = `login-ip:${getClientKey(request)}`;
  const IP_MAX_ATTEMPTS = 30;
  const perIpLimit = checkAndReserveAttempt(perIpKey, IP_MAX_ATTEMPTS);
  if (!perIpLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many login attempts. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(perIpLimit.retryAfterSeconds) } },
    );
  }

  const body = await request.json().catch(() => null);
  const username = body?.username;
  const password = body?.password;

  // Keyed by identifier+IP, not IP alone (security review finding H1):
  // an IP-only bucket meant an attacker could reset it at will by
  // logging into any account they control (trivial under MULTI_TENANT
  // self-service signup), and separately let one attacker's failures
  // lock out every legitimate user sharing that IP/proxy.
  const perAccountKey = getClientKey(request, typeof username === 'string' ? username : undefined);

  // Security review finding, fresh pre-deployment audit: checkAndReserveAttempt
  // checks AND increments in one atomic, synchronous call - the previous
  // separate check-then-await(verifyCredentials' scrypt)-then-record
  // sequence left a real window for concurrent requests to all pass the
  // check at the same count (confirmed: 60 concurrent wrong-password
  // logins let 19 through against a limit of 5). A successful login is
  // refunded below, matching this route's own existing "logins that
  // resolve to failure count, successes don't" design (see the
  // refundAttempt() call's own comment).
  //
  // A rejection here does NOT refund the per-IP reservation made above
  // (unlike the reverse direction this route used to have, back when
  // per-account was checked first) - this genuinely was a real request
  // from this IP targeting a real, currently-rate-limited account.
  // Refunding it would let an attacker who deliberately keeps hitting
  // one already-locked account dodge the per-IP spray guard indefinitely.
  const perAccountLimit = checkAndReserveAttempt(perAccountKey);
  if (!perAccountLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many login attempts. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(perAccountLimit.retryAfterSeconds) } },
    );
  }

  // Third bucket, keyed by account alone - no IP at all (security review
  // finding, third-party audit, R3-CONSOLE-M3): the per-account bucket
  // above is keyed by identifier+IP together, so it resets for an
  // attacker every time they rotate source IP - there was no ceiling
  // anywhere on total attempts against one account distributed across
  // many IPs. 50/15min is deliberately generous - real users, even
  // switching networks/devices a few times while getting their password
  // wrong, will never approach it; a real distributed attacker (the
  // threat this closes) needs many times that to make credential
  // stuffing worthwhile. Only computed here (not alongside the other two
  // buckets above) since, like the per-account bucket, it needs the
  // now-parsed username.
  const ACCOUNT_GLOBAL_MAX_ATTEMPTS = 50;
  const accountGlobalKey =
    typeof username === 'string' ? `login-account:${getAccountOnlyKey(username)}` : null;
  const accountGlobalLimit = accountGlobalKey
    ? checkAndReserveAttempt(accountGlobalKey, ACCOUNT_GLOBAL_MAX_ATTEMPTS)
    : { allowed: true as const };
  if (!accountGlobalLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many login attempts. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(accountGlobalLimit.retryAfterSeconds) } },
    );
  }

  if (
    typeof username !== 'string' ||
    typeof password !== 'string' ||
    username.length > MAX_USERNAME_LENGTH ||
    password.length > MAX_PASSWORD_LENGTH
  ) {
    return NextResponse.json({ error: 'Username and password are required' }, { status: 400 });
  }

  const identity = await verifyCredentials(username, password);
  if (!identity) {
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
      // Security review finding M5: a successful call here is real,
      // current proof this account's credential is valid against the
      // license server right now - the same authority a rejection
      // relies on to set the gate below, just the opposite outcome.
      // This is the only place in the app a successful probe can ever
      // run while accounts.tenant_revoked_at is set (see
      // clearTenantRevoked()'s own comment for why), so it's also the
      // only place that can safely clear it - making the gate
      // self-healing instead of a one-way, permanent lockout.
      const tenantId = getAccountTenantId(identity.id);
      if (tenantId) {
        clearTenantRevoked(tenantId);
      }
    } catch (err) {
      if (isTenantRejected(err)) {
        const tenantId = getAccountTenantId(identity.id);
        if (tenantId) {
          markTenantRevoked(tenantId);
        }
        return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
      }
      // Any other error: fall through and let login proceed - see the
      // fail-open note above.
    }
  }

  // Refunds only the single reservation *this* request just made in each
  // bucket above - not a full bucket wipe (security review finding
  // H1-A's own reasoning still applies: clearing every prior failure
  // would let an attacker reset their own count at will by logging into
  // any account they control, trivial under self-service signup,
  // turning the 5-attempt limit into an unbounded guessing loop in
  // cycles of 4). Leftover failed attempts from earlier requests simply
  // age out of the fixed window as normal.
  refundAttempt(perAccountKey);
  refundAttempt(perIpKey);
  if (accountGlobalKey) {
    refundAttempt(accountGlobalKey);
  }
  const token = await createSessionToken(identity);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions);

  // Operator notification (TASK_ACCOUNT_NOTIFICATIONS.md) - fire-and-
  // forget, only reached after every rate limit and the tenant-rejection
  // probe above have already passed, i.e. only on a real, successful
  // login. Self-hosted has no accounts row/email at all - identity.id
  // there is literally the configured ADMIN_UI_USERNAME (lib/auth.ts's
  // own verifyCredentials()), which is what gets shown instead.
  const loginIdentity = identity.mode === 'saas' ? (getAccountEmail(identity.id) ?? identity.id) : identity.id;
  getNotificationProvider()
    .notify({ type: 'login', email: loginIdentity })
    .catch((err) => {
      console.error(`Failed to send login notification for account ${identity.id}:`, err);
    });

  return response;
}
