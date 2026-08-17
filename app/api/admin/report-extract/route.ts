import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { isValidReportExtractKey } from '@/lib/report-extract-auth';

/**
 * GET /api/admin/report-extract (SUPERADMIN_REPORTING_DESIGN.md §6).
 *
 * A narrow, read-only, no-query-param aggregate extract: one row per
 * tenant with signup-side counts, feeding the cross-tenant reporting
 * pipeline (today, casazium/license's scripts/tenant-report.js;
 * eventually the §8 pull-and-store reporting app) - the counterpart to
 * that repo's own GET /admin/report-extract, which covers the license/
 * activation side.
 *
 * No email addresses in the response, ever (§6's own strongest
 * simplification) - none of the real reporting questions (how many
 * signed up, how active) need one, and this app's own MULTI_TENANT boot
 * guard (lib/db.ts) already keeps accounts empty on a self-hosted
 * deployment, so there's nothing to leak there either. Look up a specific
 * account directly in this console (the real source of truth) if an
 * email is ever genuinely needed.
 *
 * Fixed shape only, explicit allowlist: the response is built
 * field-by-field below from the query result, not a passthrough of
 * whatever SELECT * would return - a future column added to `accounts`
 * (or a copy/paste SELECT * mistake) can't silently start appearing here.
 *
 * No per-route rate limit: the only legitimate caller is one internal
 * script polling on its own schedule, this query is cheap even
 * unindexed at today's realistic account volume, and - unlike login/
 * signup - every request already requires a valid REPORT_EXTRACT_KEY, so
 * there's no unauthenticated attack surface an unbounded-Map limiter
 * (the exact shape security review finding SEC-M6c/FRESH-M-CONCURRENCY
 * already flagged elsewhere in this app) would be defending here.
 */
export async function GET(request: Request) {
  if (!isValidReportExtractKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Schema-compatible with multiple accounts per tenant (team invites),
  // matching casazium/license's own scripts/tenant-report.js comment on
  // its equivalent query - grouped so a future multi-account tenant
  // still produces one report row instead of one per account.
  const rows = getDb()
    .prepare(
      `
      SELECT
        tenant_id,
        MIN(created_at) AS first_signup_at,
        COUNT(*) AS account_count,
        MAX(email_verified_at) IS NOT NULL AS any_email_verified,
        MAX(tenant_revoked_at) IS NOT NULL AS any_tenant_revoked
      FROM accounts
      GROUP BY tenant_id
      `
    )
    .all() as {
    tenant_id: string;
    first_signup_at: string;
    account_count: number;
    any_email_verified: number;
    any_tenant_revoked: number;
  }[];

  const tenants = rows.map((row) => ({
    tenant_id: row.tenant_id,
    first_signup_at: row.first_signup_at,
    account_count: row.account_count,
    email_verified: Boolean(row.any_email_verified),
    tenant_revoked: Boolean(row.any_tenant_revoked),
  }));

  return NextResponse.json({ tenants });
}
