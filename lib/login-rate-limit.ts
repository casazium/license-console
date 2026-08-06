import { createHash } from 'node:crypto';
import { trustedProxyCount } from './config';

/**
 * In-memory fixed-window brute-force guard for /api/login (and, via the
 * route-prefixed keys each caller builds, /api/signup, /api/forgot-password
 * and /api/reset-password too). Adequate for a single-replica deployment
 * (this console is one Next.js container behind Coolify, see
 * docker-compose-coolify.yml) - a multi-replica deployment would need a
 * shared store (Redis) instead, since each replica would otherwise keep
 * its own independent counter.
 */

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

// Unbounded growth guard (security review finding M6): a bucket is only
// ever refreshed when *that same key* is next checked after its window
// expires (checkAndReserveAttempt's own self-cleaning overwrite below) -
// a caller that never revisits a key (many distinct real users over
// time, or a caller rotating identifier/IP combinations) leaves it
// sitting in the map forever, with nothing to remove it. Capped rather
// than left truly unbounded.
const MAX_BUCKETS = 50_000;

type Bucket = {
  count: number;
  windowStart: number;
};

const buckets = new Map<string, Bucket>();

function sweepOrEvictForSpace(now: number): void {
  // Opportunistic, not on a timer - only pays the sweep/evict cost when
  // actually about to grow the map past the cap, so the common case
  // (well under it) never runs this at all.
  if (buckets.size < MAX_BUCKETS) {
    return;
  }
  for (const [k, b] of buckets) {
    if (now - b.windowStart >= WINDOW_MS) {
      buckets.delete(k);
    }
  }
  // Still at the cap after sweeping expired entries means a sustained
  // flood of distinct keys, all still within their own window - fall
  // back to evicting the single oldest one. Bounded memory wins over
  // keeping every attacker-chosen key alive forever; the evicted key
  // just starts a fresh window if it's ever seen again, same as it
  // would after a real expiry.
  if (buckets.size >= MAX_BUCKETS) {
    let oldestKey: string | undefined;
    let oldestStart = Infinity;
    for (const [k, b] of buckets) {
      if (b.windowStart < oldestStart) {
        oldestStart = b.windowStart;
        oldestKey = k;
      }
    }
    if (oldestKey !== undefined) {
      buckets.delete(oldestKey);
    }
  }
}

/**
 * Atomically checks AND reserves one attempt in a single synchronous
 * call (security review finding, fresh pre-deployment audit): the
 * previous two-call API - check, then an awaited operation (scrypt on
 * login, a real network fetch on signup), then a separate increment -
 * left exactly that window open for concurrent requests to all pass
 * the check at the same count. Confirmed: 60 concurrent wrong-password
 * logins let 19 through against a limit of 5; 25 concurrent signups let
 * 14 through against a limit of 3, each provisioning a real tenant on
 * the license server. Since this function is synchronous and JS is
 * single-threaded, there's no window between the read and the write
 * for another request's own call to interleave.
 *
 * Callers that reserve unconditionally up front but want a specific
 * outcome (e.g. a successful login, which by design shouldn't count
 * against the limit at all - see the login route's own comment) call
 * `refundAttempt()` with the same key afterward. Callers that don't
 * need that distinction (signup, password reset) just let every
 * attempt - success or failure - count, and never call it.
 *
 * @param maxAttempts Override the default 5/window - signup passes a
 * lower value (security review finding H3): each attempt there
 * provisions a real tenant on casazium/license and sends a real email,
 * much costlier per attempt than a login password check.
 */
export function checkAndReserveAttempt(
  key: string,
  maxAttempts: number = MAX_ATTEMPTS
): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
  const bucket = buckets.get(key);
  const now = Date.now();

  if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
    sweepOrEvictForSpace(now);
    buckets.set(key, { count: 1, windowStart: now });
    return { allowed: true };
  }

  if (bucket.count >= maxAttempts) {
    const elapsed = now - bucket.windowStart;
    return { allowed: false, retryAfterSeconds: Math.ceil((WINDOW_MS - elapsed) / 1000) };
  }

  bucket.count += 1;
  return { allowed: true };
}

/**
 * Undoes exactly the one reservation the caller's own
 * `checkAndReserveAttempt()` call just made - not a full bucket wipe
 * (security review finding H1-A's own reasoning still applies: clearing
 * *every* prior failure would let an attacker reset their own count at
 * will by logging into any account they control). Safe to call
 * unconditionally on a success path; a no-op once the bucket has
 * already expired or the count is already at zero.
 */
export function refundAttempt(key: string): void {
  const bucket = buckets.get(key);
  if (bucket && bucket.count > 0) {
    bucket.count -= 1;
  }
}

/**
 * The rightmost `trustedProxyCount()` hops of X-Forwarded-For are the
 * ones our own trusted proxy chain appended, so they're accurate; every
 * hop to the left of that is client-supplied and must be treated as
 * attacker-controlled (security review finding H1-B: reading the
 * *leftmost* entry, as this used to, let a client set its own bucket to
 * anything it wanted just by sending its own X-Forwarded-For). Defaults
 * to 1 (Coolify's Traefik is the sole path in - see
 * docker-compose-coolify.yml's `expose:` rather than `ports:`); override
 * via TRUSTED_PROXY_COUNT if a deployment ever adds another hop.
 */
function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (!forwardedFor) {
    return 'direct';
  }
  const hops = forwardedFor.split(',').map((hop) => hop.trim()).filter(Boolean);
  if (hops.length === 0) {
    return 'direct';
  }
  const index = hops.length - trustedProxyCount();
  return hops[Math.max(index, 0)];
}

/**
 * Client identifier for rate-limiting purposes: IP alone for routes that
 * have no notion of "which account" (signup, forgot-password), or
 * IP+identifier for login, where keying on IP alone allowed two
 * independent bypasses (security review finding H1): an attacker could
 * reset their own bucket at will by logging into any account they
 * control (self-signup hands them one for free under MULTI_TENANT), and
 * - separately - a shared IP-only bucket means one attacker can lock out
 * every legitimate user behind the same IP/proxy. Normalized
 * (trim+lowercase) so 'User@Example.com' and 'user@example.com ' don't
 * get separate buckets.
 *
 * The identifier is hashed, not embedded raw (security review finding,
 * fresh pre-deployment audit): `username` reaches this function straight
 * from the request body with no length cap anywhere upstream, and the
 * raw string used to become the literal, retained Map key for the
 * bucket's full 15-minute window. Confirmed: 60 requests with distinct
 * 8MB usernames grew RSS by 540MB in 13 seconds, unauthenticated, no
 * valid credentials needed. Hashing makes the key a constant 64 hex
 * characters regardless of input size, closing this at the root -
 * independent of whether every current or future caller remembers to
 * length-check its own input first.
 */
export function getClientKey(request: Request, identifier?: string): string {
  const ip = getClientIp(request);
  const normalizedIdentifier = identifier?.trim().toLowerCase();
  if (!normalizedIdentifier) {
    return ip;
  }
  const identifierHash = createHash('sha256').update(normalizedIdentifier).digest('hex');
  return `${identifierHash}|${ip}`;
}
