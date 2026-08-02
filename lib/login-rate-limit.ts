/**
 * In-memory fixed-window brute-force guard for /api/login. Adequate for a
 * single-replica deployment (this console is one Next.js container behind
 * Coolify, see docker-compose-coolify.yml) - a multi-replica deployment
 * would need a shared store (Redis) instead, since each replica would
 * otherwise keep its own independent counter.
 */

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

type Bucket = {
  count: number;
  windowStart: number;
};

const buckets = new Map<string, Bucket>();

export function checkLoginRateLimit(key: string): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
  const bucket = buckets.get(key);
  if (!bucket) {
    return { allowed: true };
  }

  const elapsed = Date.now() - bucket.windowStart;
  if (elapsed >= WINDOW_MS) {
    buckets.delete(key);
    return { allowed: true };
  }

  if (bucket.count >= MAX_ATTEMPTS) {
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
 * Best-effort client identifier for rate-limiting purposes only (not a
 * security boundary by itself - see docker-compose-coolify.yml's `expose:`
 * rather than `ports:`, which makes Coolify's Traefik the sole path in for
 * this service, so X-Forwarded-For is trustworthy there). Falls back to a
 * shared key when no forwarded header is present (e.g. local `npm run dev`
 * with no proxy in front), which still protects against brute-forcing in
 * that setup - it just rate-limits all direct clients together.
 */
export function getClientKey(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  const firstHop = forwardedFor?.split(',')[0]?.trim();
  return firstHop || 'direct';
}
