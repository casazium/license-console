import { timingSafeEqual } from 'node:crypto';

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // Length must match before timingSafeEqual (it throws on mismatched
  // lengths) - same pattern as lib/auth.ts's own constantTimeEquals.
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/**
 * Auth check for GET /api/admin/report-extract
 * (SUPERADMIN_REPORTING_DESIGN.md §6) - gated by its own REPORT_EXTRACT_KEY
 * credential, deliberately not this console's session cookie or its
 * ADMIN_UI_USERNAME/PASSWORD pair: this route crosses tenant boundaries
 * (an aggregate over every tenant's accounts), and every other auth
 * mechanism in this app is intentionally scoped to at most one tenant
 * (SaaS-A3's own isolation work). A leak of this key must not also expose
 * anything a tenant session or the self-hosted admin login can reach, and
 * vice versa - kept as its own standalone credential, not reused from
 * either.
 *
 * Comma-separated multi-token support, mirroring casazium/license's own
 * equivalent hook (require-report-extract-key.js) exactly - rotation is
 * add-new-then-remove-old, not a coordinated simultaneous swap across
 * both this console and the one script that calls it.
 *
 * A plain boolean return, not a Fastify-style preHandler: Next's Route
 * Handlers have no middleware-chain concept comparable to Fastify's
 * preHandler hooks, so the caller (route.ts) checks this directly and
 * returns its own 401.
 */
export function isValidReportExtractKey(request: Request): boolean {
  const auth = request.headers.get('authorization');
  const presented = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length) : null;
  if (!presented) return false;

  const configuredKeys = (process.env.REPORT_EXTRACT_KEY || '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);

  // Empty configuredKeys (var unset) means every presented value fails to
  // match anything - fails closed by construction.
  return configuredKeys.some((key) => constantTimeEquals(presented, key));
}
