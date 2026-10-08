/**
 * Shared types for both the mock (license-client.mock.ts) and live
 * (license-client.live.ts) implementations, re-exported by the dispatcher
 * (license-client.ts) so pages only ever import from '@/lib/license-client'.
 */

export type License = {
  key: string;
  product_id: string;
  // Optional (PRODUCT_UUID_DESIGN.md, casazium/license) - the license's
  // real, immutable product identity, distinct from product_id (a
  // per-tenant display label two different tenants may share). Not
  // `required` on the backend's own response schema either - the field
  // is present on every license issued from casazium/license v1.3.0
  // onward, but the type stays optional to match.
  product_uuid?: string;
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

// Software Distribution (casazium/license's src/routes/register-release.js
// et al.) - a tenant's registered software releases. artifact_url/checksum
// point at bytes the tenant already hosts elsewhere - Casazium never
// stores or proxies the artifact itself, so there's no upload field here.
export type Release = {
  id: number;
  product_id: string;
  // Optional (PRODUCT_UUID_DESIGN.md, casazium/license) - see License's
  // matching comment above.
  product_uuid?: string;
  version: string;
  channel: string;
  platform: string;
  artifact_url: string;
  checksum: string;
  release_notes: string | null;
  status: 'published' | 'unpublished';
  created_at: string;
};

export type RegisterReleaseInput = {
  product_id: string;
  version: string;
  channel?: string;
  platform: string;
  artifact_url: string;
  checksum: string;
  release_notes?: string;
};

export type RegisterReleaseResult = {
  id: number;
  status: 'published';
  // Optional (PRODUCT_UUID_DESIGN.md, casazium/license) - see License's
  // matching comment above. This is the response an integrator should
  // actually read this value from: the register-release call they make
  // anyway, not a separate lookup.
  product_uuid?: string;
};

export type ListReleasesParams = {
  product_id?: string;
  channel?: string;
  platform?: string;
  status?: 'published' | 'unpublished';
  limit?: number;
  offset?: number;
};

export type ListReleasesResult = {
  releases: Release[];
  total: number;
};

// GET /release/:id (casazium/license's src/routes/admin-release.js,
// added round-3 independent review finding C-2) - the fields
// GET /list-releases deliberately omits per row (Release above), plus
// `signature`, for a release detail view.
export type ReleaseDetail = Release & {
  signature: string;
};

// Mirrors casazium/license's own BillingProvider.getSubscriptionStatus
// return shape exactly (src/lib/billing/provider.js) - SaaS-B4.
// licensesUsed/licenseLimit added for BETA_LAUNCH_STATUS.md §4's
// quota-visibility beta-readiness finding - null under self-hosted
// (no tenantId, no plan concept at all - same posture as `plan` itself).
// cancelAtPeriodEnd/currentPeriodEnd surface a pending-but-not-yet-
// effective Stripe cancellation (status/plan stay unchanged until it
// actually takes effect) - always false/null under the stub or
// self-hosted, real values only from a real Stripe-backed deployment.
export type BillingStatus = {
  status: 'active' | 'past_due' | 'canceled';
  plan: string | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  licensesUsed: number | null;
  licenseLimit: number | null;
};

// The connected License Server backend's own version (its package.json
// version, see casazium/license's src/lib/version.js), distinct from this
// console's own APP_VERSION (lib/version.ts) - the two are independently
// versioned repos/deployments. null when the backend couldn't be reached
// or returned something unexpected - this is a footer nicety, not
// something that should ever block rendering the page it's shown on.
export type BackendVersion = {
  version: string;
} | null;

// STOREFRONT_WEBHOOK_PLAN.md - inbound purchase-webhook auto-fulfillment.
// Mirrors casazium/license's src/routes/admin-storefront-webhooks.js
// response shapes exactly. 'stripe' (Stripe Payment Links) and
// 'lemonsqueezy' (License Server 1.7.0+, LEMON_SQUEEZY_FULFILLMENT_DESIGN.md
// there) - another storefront provider adds another value here, not a new
// type.
export type StorefrontWebhookProvider = 'stripe' | 'lemonsqueezy';

// 'pending' - row exists, webhook URL can be shown, but no secret has
// been saved yet (POST .../secret hasn't succeeded), so the route
// rejects every real delivery with a signature-verification failure.
// 'disabled' is soft (DELETE .../:id never hard-deletes - schema.sql's
// own comment on storefront_purchase_events/storefront_product_mappings
// needing a stable FK target to survive under).
export type StorefrontWebhookStatus = 'pending' | 'active' | 'disabled';

// What a full refund does (casazium/license 1.8.0+,
// REFUND_REVOCATION_DESIGN.md there): revoke the license the purchase
// issued, or only record the refund.
export type StorefrontRefundPolicy = 'revoke' | 'record';

export type StorefrontWebhook = {
  id: string;
  provider: StorefrontWebhookProvider;
  status: StorefrontWebhookStatus;
  created_at: string;
  last_event_at: string | null;
  // Absent from a License Server older than 1.8.0 - which is how this
  // console tells whether refund handling exists at all.
  refund_policy?: StorefrontRefundPolicy;
  // License Server 1.9.0+ (absent before - the same way this console
  // tells whether subscriptions exist): days a subscription's license
  // stays valid past its paid period, 0-30.
  subscription_grace_days?: number;
};

// Per provider (the server rejects a kind its webhook's provider never
// produces - storefront-adapters.js's STOREFRONT_REF_KINDS):
// - Stripe: a Payment Link's own id ('payment_link'), or
// - Lemon Squeezy: a variant's numeric id ('variant'), or
// - either: a value the tenant sets themselves as `casazium_ref` (Stripe
//   Checkout Session metadata, or Lemon Squeezy checkout custom data) -
//   useful when several links/variants should resolve to one mapping.
export type StorefrontMappingRefKind = 'payment_link' | 'variant' | 'metadata';

export type StorefrontMapping = {
  id: string;
  webhook_id: string;
  tenant_id: string;
  provider: StorefrontWebhookProvider;
  ref_kind: StorefrontMappingRefKind;
  external_ref: string;
  product_id: string;
  tier: string;
  // Raw JSON text, exactly as stored (storefront_product_mappings.limits_json) -
  // never parsed/re-validated client-side beyond what the create form
  // itself already sent past the server's own validateLicenseLimits.js.
  limits_json: string | null;
  max_activations: number | null;
  duration_days: number | null;
  notes: string | null;
  created_at: string;
};

export type CreateStorefrontMappingInput = {
  ref_kind: StorefrontMappingRefKind;
  external_ref: string;
  product_id: string;
  tier: string;
  // Raw JSON text from the form's own textarea - parsed once, here in
  // this console, only to catch a malformed-JSON typo before it reaches
  // the server at all; the server is still the real source of truth for
  // whether the parsed object is a *valid* limits shape (validateLicenseLimits.js).
  limitsJson?: string;
  max_activations?: number;
  duration_days?: number;
  notes?: string;
};

// The outcome vocabulary storefront-webhook.js's own claim ledger writes
// to storefront_purchase_events.outcome - see that file's header comment.
// 'processing'/'awaiting_payment' are non-terminal (a claim in flight, or
// a delayed payment method not yet confirmed) - every other value is
// terminal for re-issuance purposes.
export type StorefrontDeliveryOutcome =
  | 'processing'
  | 'awaiting_payment'
  | 'issued'
  | 'unmapped'
  | 'over_quota'
  | 'invalid_input'
  | 'error'
  // License Server 1.8.0+: fully refunded before a license was issued,
  // so none was.
  | 'refunded_before_issue';

export type StorefrontDeliveryStatus = 'pending' | 'sending' | 'sent';

export type StorefrontDelivery = {
  tenant_id: string;
  checkout_session_id: string;
  outcome: StorefrontDeliveryOutcome;
  attempts: number;
  license_key: string | null;
  delivery_status: StorefrontDeliveryStatus;
  processed_at: string | null;
  // License Server 1.8.0+ (absent before); null until a refund arrives.
  // refund_kind 'full' is final. Amounts are the provider's smallest
  // currency unit, for display only.
  refund_kind?: 'partial' | 'full' | null;
  refunded_at?: string | null;
  refund_action?: StorefrontRefundAction | null;
  refunded_amount?: number | null;
  amount_total?: number | null;
  // License Server 1.9.0+ (absent before): the subscription holding this
  // purchase's license, null for a one-time purchase. Dates are ISO 8601.
  subscription_id?: string | null;
  subscription_state?: StorefrontSubscriptionState | null;
  subscription_paid_through?: string | null;
  subscription_ends_at?: string | null;
  subscription_closed_at?: string | null;
  // Over a day old, still open, nothing paid or granted: the payment
  // events are probably not enabled.
  subscription_events_missing?: boolean;
};

// 'ending' = canceled, runs to its end; 'ended' = lapsed for non-payment
// (can still be reactivated); 'terminal' = over for good.
export type StorefrontSubscriptionState = 'active' | 'trialing' | 'past_due' | 'ending' | 'ended' | 'terminal';

export type StorefrontRefundAction = 'revoked' | 'recorded' | 'no_license' | 'already_revoked' | 'revoke_failed';

export type ListStorefrontDeliveriesParams = {
  limit?: number;
  offset?: number;
};

// GET .../deliveries has no server-side COUNT, only LIMIT/OFFSET
// (admin-storefront-webhooks.js) - unlike every other paginated list in
// this console (listLicenses/listReleases both return a real `total`).
// hasMore is derived client-side instead: a full page back
// (`deliveries.length === limit requested`) means there may be more.
export type ListStorefrontDeliveriesResult = {
  deliveries: StorefrontDelivery[];
  hasMore: boolean;
};
