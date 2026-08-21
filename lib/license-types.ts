/**
 * Shared types for both the mock (license-client.mock.ts) and live
 * (license-client.live.ts) implementations, re-exported by the dispatcher
 * (license-client.ts) so pages only ever import from '@/lib/license-client'.
 */

export type License = {
  key: string;
  product_id: string;
  tier: string;
  status: 'active' | 'revoked';
  issued_to: string;
  issued_at: string;
  // Nullable (independent-review finding, surfaced while building the
  // license-terms edit route): the real backend has treated null as
  // perpetual for a while now (casazium/license's own pre-launch gap
  // analysis finding #10), but this type declared it non-nullable
  // regardless - GET /admin/license/:key already returns real nulls for
  // perpetual licenses, so every reader of this field was silently lying
  // about what it held. lib/format.ts's formatDate/formatDateTime are
  // now null-tolerant to match.
  expires_at: string | null;
  // Real fields the backend actually returns (GET /admin/license/:key -
  // casazium/license's admin-license.js), replacing the usage_limit/
  // usage_count pair below that never matched anything the live backend
  // sends (see that field's own removal note) - only license-client.mock.ts
  // ever populated them, so the live detail page rendered
  // "undefined / undefined" for every real license until this fix.
  limits: LicenseLimits;
  usage: Record<string, number>;
  // Nullable (independent-review finding): null means unlimited seats,
  // already true on the backend (license_keys.max_activations has no
  // NOT NULL constraint, and activate-license.js's own seat check skips
  // entirely when this isn't a number) - the license-terms edit route
  // can now set this state, so the type needs to be able to represent it.
  max_activations: number | null;
  revoked_at: string | null;
  // Freeform operator context ("renewed via phone call", "beta
  // customer") - editable independently of issuing the license (see
  // updateLicenseNotes below), not just set once at creation. Not part
  // of RawLicenseListRow/LicenseListItem below - deliberately left out
  // of GET /list-licenses's per-row payload on the backend, since that's
  // a fixed page of table rows and notes is unbounded free text with no
  // use there. Shown/edited on the license detail page instead.
  notes: string | null;
};

export type Activation = {
  instance_id: string;
  activated_at: string;
};

export type DashboardStats = {
  active_licenses: number;
  active_activations: number;
  revoked_licenses: number;
};

export type RecentActivation = {
  key: string;
  instance_id: string;
  activated_at: string;
};

export type ExpiringLicense = {
  key: string;
  product_id: string;
  tier: string;
  issued_to: string;
  expires_at: string;
};

export type SeatUtilization = {
  key: string;
  product_id: string;
  tier: string;
  used: number;
  max_activations: number;
  remaining: number;
};

export type RecentlyIssuedLicense = {
  key: string;
  product_id: string;
  tier: string;
  issued_to: string;
  issued_at: string;
};

// Mirrors casazium/license's GET /v1/self-license/status response
// exactly (src/lib/self-license-client.js's getSelfLicenseStatus()) -
// 'tier-a' covers every non-Tier-B backend, which is most deployments;
// 'tier-b' always carries a lastOutcome, null only before the connected
// backend's very first call-home attempt has resolved.
//
// 'restored': a real, meaningfully different state from 'success' - the
// backend found a still-valid cached credential on boot and skipped a
// fresh call-home entirely, so `at` is this boot's confirmation time,
// not the original issuance time, and `expiresAt` is never present
// here (no way for the backend to know it - see that repo's own
// recordOutcome() call site for why). Distinguishing this from a plain
// null lastOutcome is the whole point: "verified previously, currently
// trusted" reads very differently from "never checked in at all" on a
// beta-testing indicator, even though both would otherwise look
// identical on every redeploy that lands inside the 14-day credential
// validity window.
export type SelfLicenseOutcome = {
  outcome: 'success' | 'failure' | 'misconfigured' | 'load-error' | 'restored';
  at: string;
  expiresAt?: string;
  // The real self-license *subscription's* own expiry (casazium/license's
  // credential.rs subscription_expires_at), NOT the same thing as
  // expiresAt above - that's always just the rolling ~14-day credential
  // cache window, renewed automatically on every successful call-home.
  // This is the operator-meaningful date a lapsed subscription actually
  // matters on, previously invisible anywhere until call-home simply
  // started failing with no advance warning. Only ever present on a
  // 'success' outcome, and only from an MLS build new enough to send it -
  // absent (not null) otherwise, same optional-field convention as
  // expiresAt.
  subscriptionExpiresAt?: string;
  error?: string;
};

export type SelfLicenseStatus =
  | { tier: 'tier-a' }
  | { tier: 'tier-b'; lastOutcome: SelfLicenseOutcome | null };

// Mirrors casazium/license's GET /v1/admin/tier-a-status response exactly
// (src/lib/tier-a-license.js's inspectTierALicense()). Deliberately a
// LIVE re-check on that repo's side, not a memo of what its boot gate
// decided once at startup - see that function's own header comment for
// why: a running instance keeps serving requests unchanged even after
// its own license's expiresAt passes (no periodic re-check by design),
// so this can report 'expired' for an instance that is, in fact, still
// up and healthy right now - the console's own indicator (see
// TierAStatusIndicator.tsx) is what turns that into the "will not
// restart" warning, not a claim that anything is broken this instant.
//
// applicable: false covers both a Tier-B build (its own, unrelated
// call-home mechanism applies instead - see SelfLicenseStatus above) and
// Casazium's own internal watermark (no purchased activation license
// needed for itself) - the console hides this indicator entirely for
// either case, same "decide my own visibility" posture as
// SelfLicenseIndicator's own tier: 'tier-a' branch.
//
// 'not-configured'/'invalid' are real, reachable states on an actually-
// running server - not just theoretical - if it's up at all under a
// CASAZIUM_UNLICENSED_EVAL=1 evaluation allowance rather than a genuine
// activation license (that repo's own checkTierABoot() would otherwise
// have refused to boot in the first place).
export type TierAStatus =
  | { applicable: false; reason: 'tier-b' | 'internal' }
  | { applicable: true; status: 'not-configured' }
  | { applicable: true; status: 'invalid'; reason: string }
  | { applicable: true; status: 'perpetual'; issuedTo: string; expiresAt: null }
  | { applicable: true; status: 'active'; issuedTo: string; expiresAt: string }
  | { applicable: true; status: 'expired'; issuedTo: string; expiresAt: string };

// Mirrors casazium/license's own ALLOWED_LIMIT_KEYS exactly (that repo's
// src/lib/validateLicenseLimits.js) - every key optional (an admin sets
// only the limits that apply to a given product/tier; an absent key
// means "not enforced", not "zero"), all non-negative integers except
// `features`, which is the one array-of-strings exception on that
// backend allow-list.
export type LicenseLimits = {
  users?: number;
  seats?: number;
  admins?: number;
  projects?: number;
  environments?: number;
  tenants?: number;
  api_calls_per_day?: number;
  rate_limit_rps?: number;
  concurrent_sessions?: number;
  features?: string[];
};

export type IssueLicenseInput = {
  product_id: string;
  tier: string;
  issued_to: string;
  expires_at: string;
  max_activations: number;
  notes?: string;
  limits?: LicenseLimits;
};

// POST /admin/update-license-terms (casazium/license) - every field
// independently optional; only the fields present in the request are
// changed. expires_at: null sets the license to perpetual;
// max_activations: null sets it to unlimited seats. limits, if provided,
// replaces the whole object (not a merge) - see that route's own
// docblock for why a merge mode isn't offered.
export type UpdateLicenseTermsInput = {
  key: string;
  expires_at?: string | null;
  max_activations?: number | null;
  limits?: LicenseLimits;
};

export type UpdateLicenseTermsResult = {
  key: string;
  expires_at: string | null;
  limits: LicenseLimits;
  max_activations: number | null;
  usage: Record<string, number>;
  status: 'active' | 'revoked';
  // Real current activation count, so the caller can warn when a lowered
  // max_activations just went below what's already in use (a soft cap,
  // not blocked - see the route's own docblock).
  activations_count: number;
};

// GET /list-licenses returns activations_count per row directly (a
// correlated subquery server-side - see casazium/license's
// src/routes/list-licenses.js). Scoped to this list-row shape rather than
// added to the base License type above: GET /admin/license/:key (used by
// getLicense) has no such field, and the license detail page that calls it
// already fetches the activation list separately - adding
// activations_count to License itself would make that call site's return
// type claim a field the real response never has.
export type RawLicenseListRow = License & { activations_count: number };

export type LicenseListItem = License & { activations_used: number };

// Wire values match casazium/license's GET /list-licenses `sort` enum
// exactly - 'activations_count' rather than this console's own
// 'activations_used' field name, since that's the real correlated-subquery
// SELECT alias the backend sorts by.
export type LicenseSortColumn =
  | 'key'
  | 'product_id'
  | 'tier'
  | 'status'
  | 'issued_to'
  | 'expires_at'
  | 'activations_count';

export type ListLicensesParams = {
  status?: 'active' | 'revoked';
  product_id?: string;
  // Customer search (pre-launch gap analysis finding #4): case-insensitive
  // substring match against issued_to on the backend (see casazium/license's
  // src/routes/list-licenses.js).
  issued_to?: string;
  // License-key search (BETA_LAUNCH_STATUS.md §4): same substring-match
  // pattern as issued_to above.
  key?: string;
  // Server-side sort (BETA_LAUNCH_STATUS.md §4) - defaults to issued_at
  // desc when omitted, matching this route's pre-existing behavior.
  sort?: LicenseSortColumn;
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
};

export type ListLicensesResult = {
  licenses: LicenseListItem[];
  total: number;
};

// Mirrors casazium/license's own BillingProvider.getSubscriptionStatus
// return shape exactly (src/lib/billing/provider.js) - SaaS-B4.
// licensesUsed/licenseLimit added for BETA_LAUNCH_STATUS.md §4's
// quota-visibility beta-readiness finding - null under self-hosted
// (no tenantId, no plan concept at all - same posture as `plan` itself).
export type BillingStatus = {
  status: 'active' | 'past_due' | 'canceled';
  plan: string | null;
  licensesUsed: number | null;
  licenseLimit: number | null;
};
