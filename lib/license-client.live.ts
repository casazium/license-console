/**
 * LIVE license-server client - real HTTP calls to casazium/license, using
 * LICENSE_API_URL (including the /v1 prefix) and LICENSE_ADMIN_API_KEY.
 * Used for connected mode - see license-client.ts's mode dispatcher.
 *
 * Endpoint mapping and known gaps are documented in PROJECT_STATUS.md §14.
 * Two gaps worth knowing before reading further:
 * - activations_used (the Seats column) has no backend field - computed
 *   here with a GET /list-activations/:key call per license row.
 * - getExpiringLicenses/getLicensesNearSeatLimit have no backend
 *   equivalent at all - computed here from a broad GET /list-licenses
 *   fetch (up to the backend's own 1000-row max), since GET /list-licenses
 *   has no sort parameter to do this server-side. Real cost at high
 *   license counts; accepted for now, see PROJECT_STATUS.md §14.
 */

import type {
  Activation,
  DashboardStats,
  ExpiringLicense,
  IssueLicenseInput,
  License,
  ListLicensesParams,
  ListLicensesResult,
  RecentActivation,
  RecentlyIssuedLicense,
  SeatUtilization,
} from './license-types';

// The real backend's own GET /list-licenses limit ceiling (see
// list-licenses.js's schema: `limit: { maximum: 1000 }`) - used as the
// "fetch everything" page size for the dashboard-derived functions below,
// which have no server-side equivalent to ask for directly.
const BROAD_FETCH_LIMIT = 1000;

function baseUrl(): string {
  const url = process.env.LICENSE_API_URL?.trim();
  if (!url) {
    throw new Error('Missing required environment variable: LICENSE_API_URL');
  }
  return url.replace(/\/$/, '');
}

function adminKey(): string {
  const key = process.env.LICENSE_ADMIN_API_KEY?.trim();
  if (!key) {
    throw new Error('Missing required environment variable: LICENSE_ADMIN_API_KEY');
  }
  return key;
}

async function liveFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminKey()}`,
      ...init.headers,
    },
    cache: 'no-store',
  });
}

async function fetchRawLicenses(params: {
  status?: 'active' | 'revoked';
  product_id?: string;
  limit: number;
  offset: number;
}): Promise<{ licenses: License[]; total: number }> {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.product_id) query.set('product_id', params.product_id);
  query.set('limit', String(params.limit));
  query.set('offset', String(params.offset));

  const res = await liveFetch(`/list-licenses?${query.toString()}`);
  if (!res.ok) {
    throw new Error(`Failed to list licenses: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function listLicenses(params: ListLicensesParams = {}): Promise<ListLicensesResult> {
  const { status, product_id, limit = 10, offset = 0 } = params;
  const { licenses, total } = await fetchRawLicenses({ status, product_id, limit, offset });

  // Bounded by this page's size (10 by default), not the full dataset -
  // see the module docblock.
  const enriched = await Promise.all(
    licenses.map(async (license) => ({
      ...license,
      activations_used: (await listActivations(license.key)).length,
    }))
  );

  return { licenses: enriched, total };
}

export async function getLicense(key: string): Promise<License | null> {
  const res = await liveFetch(`/admin/license/${encodeURIComponent(key)}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Failed to get license: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function issueLicense(input: IssueLicenseInput): Promise<{ key: string }> {
  const res = await liveFetch('/issue-license', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(`Failed to issue license: ${res.status} ${res.statusText}`);
  }
  const data: { key: string } = await res.json();
  return { key: data.key };
}

export async function setLicenseRevoked(key: string, revoked: boolean): Promise<void> {
  const res = await liveFetch('/revoke-license', {
    method: 'POST',
    body: JSON.stringify({ key, revoked }),
  });
  // 409 means the license is already in the desired state - treat as a
  // successful no-op rather than an error, since the end result (the
  // license's status matches what was requested) is the same either way.
  if (!res.ok && res.status !== 409) {
    throw new Error(`Failed to update license status: ${res.status} ${res.statusText}`);
  }
}

export async function deleteLicense(key: string): Promise<boolean> {
  const res = await liveFetch('/delete-license', {
    method: 'DELETE',
    body: JSON.stringify({ key }),
  });
  if (res.status === 404) return false;
  if (!res.ok) {
    throw new Error(`Failed to delete license: ${res.status} ${res.statusText}`);
  }
  return true;
}

export async function listActivations(key: string): Promise<Activation[]> {
  const res = await liveFetch(`/list-activations/${encodeURIComponent(key)}`);
  if (res.status === 404) return [];
  if (!res.ok) {
    throw new Error(`Failed to list activations: ${res.status} ${res.statusText}`);
  }
  const data: { key: string; activations: Activation[] } = await res.json();
  return data.activations;
}

export async function reissueActivationToken(
  key: string,
  instanceId: string
): Promise<{ token: string } | null> {
  const res = await liveFetch('/admin/reissue-token', {
    method: 'POST',
    body: JSON.stringify({ key, instance_id: instanceId }),
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Failed to reissue activation token: ${res.status} ${res.statusText}`);
  }
  const data: { reissued: boolean; token: string } = await res.json();
  return { token: data.token };
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const res = await liveFetch('/admin/stats');
  if (!res.ok) {
    throw new Error(`Failed to get dashboard stats: ${res.status} ${res.statusText}`);
  }
  const data: {
    activeLicenses: number;
    revokedLicenses: number;
    totalActivations: number;
  } = await res.json();

  return {
    active_licenses: data.activeLicenses,
    // POST /deactivate-license deletes the activation row outright (not a
    // soft-delete, confirmed against the backend source) - totalActivations
    // and "currently active activations" are the same number.
    active_activations: data.totalActivations,
    revoked_licenses: data.revokedLicenses,
  };
}

export async function getRecentActivations(limit = 5): Promise<RecentActivation[]> {
  const res = await liveFetch(`/recent-activations?limit=${limit}`);
  if (!res.ok) {
    throw new Error(`Failed to get recent activations: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function getExpiringLicenses(withinDays = 30, limit = 5): Promise<ExpiringLicense[]> {
  const { licenses } = await fetchRawLicenses({
    status: 'active',
    limit: BROAD_FETCH_LIMIT,
    offset: 0,
  });

  const now = Date.now();
  const cutoff = now + withinDays * 24 * 60 * 60 * 1000;

  return licenses
    .filter((license) => {
      const expiresAt = new Date(license.expires_at).getTime();
      return expiresAt >= now && expiresAt <= cutoff;
    })
    .sort((a, b) => (a.expires_at < b.expires_at ? -1 : 1))
    .slice(0, limit)
    .map(({ key, product_id, tier, issued_to, expires_at }) => ({
      key,
      product_id,
      tier,
      issued_to,
      expires_at,
    }));
}

export async function getLicensesNearSeatLimit(limit = 5): Promise<SeatUtilization[]> {
  const { licenses } = await fetchRawLicenses({
    status: 'active',
    limit: BROAD_FETCH_LIMIT,
    offset: 0,
  });

  const withUsage = await Promise.all(
    licenses.map(async (license) => {
      const used = (await listActivations(license.key)).length;
      return {
        key: license.key,
        product_id: license.product_id,
        tier: license.tier,
        used,
        max_activations: license.max_activations,
        remaining: license.max_activations - used,
      };
    })
  );

  return withUsage
    .filter((entry) => entry.remaining <= 1)
    .sort((a, b) => a.remaining - b.remaining)
    .slice(0, limit);
}

export async function getRecentlyIssuedLicenses(limit = 5): Promise<RecentlyIssuedLicense[]> {
  // No broad fetch needed here, unlike the two functions above: the real
  // GET /list-licenses already defaults to ORDER BY issued_at DESC, so
  // asking for exactly `limit` rows already gives the most recently
  // issued licenses in the right order.
  const { licenses } = await fetchRawLicenses({ limit, offset: 0 });

  return licenses.map(({ key, product_id, tier, issued_to, issued_at }) => ({
    key,
    product_id,
    tier,
    issued_to,
    issued_at,
  }));
}
