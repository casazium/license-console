import { listLicenses } from './license-client';
import type { LicenseListItem } from './license-types';

// GET /list-licenses' own schema caps a single page at 1000
// (casazium/license's list-licenses.js) - fetching more than that means
// looping over pages, not asking for a bigger `limit`.
export const LIST_LICENSES_PAGE_SIZE = 1000;

// An absolute safety ceiling on GET /api/export-data's own worst case,
// deliberately NOT tied to any one plan's active-license limit
// (independent Opus security review, 2026-08-22: casazium/license's
// quota check only counts active, unexpired licenses, so a tenant can
// accumulate far more total rows than their plan's quota once
// expired/revoked licenses pile up, and every one of those rows is still
// exported here). This used to be a single-page fetch capped at 1000
// total, which happened to always be enough while Pro (1,000 active
// licenses) was the highest tier - no real tenant could exceed it.
// Adding the Business tier (10,000 active licenses) exposed that
// assumption: a Business tenant above 1,000 active licenses got a
// silently truncated "full" export - a normal 200 response and a
// valid-looking download, with the shortfall visible only in a
// server-side console.warn the tenant never sees. Fixed by looping over
// pages instead of raising the single-page `limit` (the backend caps
// that at 1000 regardless of what's asked for); this constant is now how
// many total licenses that loop will fetch before giving up and
// reporting a real truncation, set well above any current plan's ceiling
// to leave headroom for historical expired/revoked rows.
export const MAX_EXPORT_LICENSES = 25000;

/**
 * Loops GET /list-licenses across pages of LIST_LICENSES_PAGE_SIZE until
 * every license is fetched or MAX_EXPORT_LICENSES is hit, instead of the
 * single capped-at-1000 call GET /api/export-data used to make (see
 * MAX_EXPORT_LICENSES's own comment above for why that broke once a
 * tenant could hold more than 1,000 licenses). Sequential, not
 * concurrent, on purpose: this backs a one-time, cooldown-gated snapshot
 * export, not a latency-sensitive path, and fetching pages one at a time
 * avoids list-licenses.js's own documented LIMIT/OFFSET caveat (rows can
 * duplicate or skip across pages if the underlying data changes between
 * calls) getting worse under concurrent requests for the same tenant.
 */
export async function fetchAllLicenses(
  tenantApiKey: string
): Promise<{ licenses: LicenseListItem[]; total: number }> {
  const licenses: LicenseListItem[] = [];
  let total = Infinity;

  while (licenses.length < total && licenses.length < MAX_EXPORT_LICENSES) {
    const page = await listLicenses({ limit: LIST_LICENSES_PAGE_SIZE, offset: licenses.length }, tenantApiKey);
    total = page.total;
    if (page.licenses.length === 0) break; // Defensive: avoids an infinite loop if total is ever wrong.
    licenses.push(...page.licenses);
  }

  return { licenses, total };
}
