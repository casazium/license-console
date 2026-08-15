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
  expires_at: string;
  usage_limit: number | null;
  usage_count: number;
  max_activations: number;
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
export type SelfLicenseOutcome = {
  outcome: 'success' | 'failure' | 'misconfigured' | 'load-error';
  at: string;
  expiresAt?: string;
  error?: string;
};

export type SelfLicenseStatus =
  | { tier: 'tier-a' }
  | { tier: 'tier-b'; lastOutcome: SelfLicenseOutcome | null };

export type IssueLicenseInput = {
  product_id: string;
  tier: string;
  issued_to: string;
  expires_at: string;
  max_activations: number;
  notes?: string;
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

export type ListLicensesParams = {
  status?: 'active' | 'revoked';
  product_id?: string;
  limit?: number;
  offset?: number;
};

export type ListLicensesResult = {
  licenses: LicenseListItem[];
  total: number;
};

// Mirrors casazium/license's own BillingProvider.getSubscriptionStatus
// return shape exactly (src/lib/billing/provider.js) - SaaS-B4.
export type BillingStatus = {
  status: 'active' | 'past_due' | 'canceled';
  plan: string | null;
};
