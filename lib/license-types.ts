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

export type IssueLicenseInput = {
  product_id: string;
  tier: string;
  issued_to: string;
  expires_at: string;
  max_activations: number;
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
