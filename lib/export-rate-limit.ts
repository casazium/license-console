/**
 * Per-account cooldown for GET /api/export-data (independent Opus
 * security review of that route, 2026-08-22 - see PROJECT_STATUS.md).
 *
 * The review found the route's N+1 activations fan-out has no real
 * ceiling: plan quotas don't keep license counts low the way they might
 * look like they do, since casazium/license's quota check only counts
 * active, unexpired licenses (quota.js's countActiveLicenses) - a tenant
 * can issue many already-expired licenses that cost nothing against
 * quota but are still exported, driving the fan-out toward the route's
 * own real ceiling (lib/export-licenses.ts's MAX_EXPORT_LICENSES,
 * originally 1000, raised to 25000 once the Business tier's 10,000-
 * license plan made 1000 too low even for active licenses alone -
 * PROJECT_STATUS.md's Business-tier entry). Bounding per-request
 * concurrency (route.ts's own mapWithConcurrency) stops a single request
 * from opening up that many sockets at once; this cooldown is the second
 * half - it stops a tenant from *repeatedly* triggering that fan-out and
 * burning through casazium/license's own ADMIN_RATE_LIMIT_MAX (300
 * requests / 15 min per tenant, shared with every other admin action
 * that tenant takes), which the review showed a single ~100-license
 * tenant could exhaust in three clicks - fewer clicks still, now that
 * the real ceiling is bigger.
 *
 * Same bounded in-memory Map shape as login-rate-limit.ts (this is a
 * single-replica deployment - see that file's own header for why an
 * in-memory store is an accepted tradeoff here, not an oversight) but
 * deliberately a separate, smaller module: this is a resource-cost
 * throttle on one already-authenticated route, not a brute-force guard
 * on an auth boundary, and doesn't need that file's allowed/refund
 * semantics (a wrong password shouldn't count against a login budget;
 * a slow export attempt has no equivalent "innocent failure" to not
 * count).
 */

const COOLDOWN_MS = 60 * 1000;
const MAX_ENTRIES = 10_000;

const lastExportAt = new Map<string, number>();

function sweepOrEvictForSpace(now: number): void {
  if (lastExportAt.size < MAX_ENTRIES) {
    return;
  }
  for (const [key, at] of lastExportAt) {
    if (now - at >= COOLDOWN_MS) {
      lastExportAt.delete(key);
    }
  }
  if (lastExportAt.size >= MAX_ENTRIES) {
    let oldestKey: string | undefined;
    let oldestAt = Infinity;
    for (const [key, at] of lastExportAt) {
      if (at < oldestAt) {
        oldestKey = key;
        oldestAt = at;
      }
    }
    if (oldestKey !== undefined) {
      lastExportAt.delete(oldestKey);
    }
  }
}

/**
 * Returns null if this account may proceed (and records the attempt),
 * or the number of seconds to wait if it's still in cooldown.
 */
export function checkExportCooldown(accountId: string): number | null {
  const now = Date.now();
  const last = lastExportAt.get(accountId);
  if (last !== undefined && now - last < COOLDOWN_MS) {
    return Math.ceil((COOLDOWN_MS - (now - last)) / 1000);
  }
  sweepOrEvictForSpace(now);
  lastExportAt.set(accountId, now);
  return null;
}
