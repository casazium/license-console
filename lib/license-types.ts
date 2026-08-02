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

// The real GET /list-licenses response has no activation-count field at
// all (confirmed against casazium/license's src/routes/list-licenses.js) -
// activations_used is enrichment both implementations add: the mock reads
// its own in-memory store, the live client makes one GET
// /list-activations/:key call per row in the current page (bounded by
// page size, not the full dataset - see license-client.live.ts).
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
