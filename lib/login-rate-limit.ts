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

type Bucket = {
  count: number;
  windowStart: number;
};

const buckets = new Map<string, Bucket>();

/**
 * @param maxAttempts Override the default 5/window - signup passes a
 * lower value (security review finding H3): each attempt there
 * provisions a real tenant on casazium/license and sends a real email,
 * much costlier per attempt than a login password check.
 */
export function checkLoginRateLimit(
  key: string,
  maxAttempts: number = MAX_ATTEMPTS
): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
  const bucket = buckets.get(key);
  if (!bucket) {
    return { allowed: true };
  }

  const elapsed = Date.now() - bucket.windowStart;
  if (elapsed >= WINDOW_MS) {
    buckets.delete(key);
    return { allowed: true };
  }

  if (bucket.count >= maxAttempts) {
    return { allowed: false, retryAfterSeconds: Math.ceil((WINDOW_MS - elapsed) / 1000) };
  }

  return { allowed: true };
}

export function recordFailedLoginAttempt(key: string): void {
  const bucket = buckets.get(key);
  const now = Date.now();

  if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
    buckets.set(key, { count: 1, windowStart: now });
    return;
  }

  bucket.count += 1;
}

export function clearLoginRateLimit(key: string): void {
  buckets.delete(key);
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
 */
export function getClientKey(request: Request, identifier?: string): string {
  const ip = getClientIp(request);
  const normalizedIdentifier = identifier?.trim().toLowerCase();
  return normalizedIdentifier ? `${normalizedIdentifier}|${ip}` : ip;
}
