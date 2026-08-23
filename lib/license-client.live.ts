/**
 * LIVE license-server client - real HTTP calls to casazium/license, using
 * LICENSE_API_URL (including the /v1 prefix) and, by default,
 * LICENSE_ADMIN_API_KEY. Used for connected mode - see license-client.ts's
 * mode dispatcher.
 *
 * Endpoint mapping and known gaps are documented in PROJECT_STATUS.md §14.
 * One gap worth knowing before reading further: getExpiringLicenses/
 * getLicensesNearSeatLimit have no backend equivalent at all - computed
 * here from a broad GET /list-licenses fetch (up to the backend's own
 * 1000-row max, deduped between the two via getBroadActiveLicenses since
 * both need the same data). GET /list-licenses does now support a
 * `sort` parameter (BETA_LAUNCH_STATUS.md §4), but only for a single
 * real/aliased column at a time - not the derived "expiring within N
 * days" / "seat usage above a ratio" predicates these two functions
 * actually need, so both still page through everything client-side.
 * Real cost at high license counts; accepted for now, see
 * PROJECT_STATUS.md §14.
 *
 * activations_used (the Seats column) used to be the same kind of gap -
 * one GET /list-activations/:key call per license row - until
 * GET /list-licenses grew a server-side activations_count field
 * (casazium/license's list-licenses.js), which every function below now
 * reads directly instead.
 *
 * SaaS-B2: every exported function below takes an optional trailing
 * `tenantApiKey`, threaded explicitly from the caller (lib/session.ts's
 * requireSession() + lib/tenant-context.ts's getTenantApiKey(), resolved
 * once per page render/Server Action, not per call) rather than an
 * ambient global - see resolveApiKey() below for the fail-closed rule
 * this enables. self-hosted callers (MULTI_TENANT unset) simply never
 * pass it, and every call site behaves byte-identically to before this
 * task, per PROJECT_STATUS.md §5's disposability rule.
 */

import { cache } from 'react';
import { LicenseApiError } from './errors';
import { isMultiTenant } from './config';
import type {
  Activation,
  BillingStatus,
  DashboardStats,
  ExpiringLicense,
  IssueLicenseInput,
  License,
  LicenseSortColumn,
  ListLicensesParams,
  ListLicensesResult,
  ListReleasesParams,
  ListReleasesResult,
  RawLicenseListRow,
  RecentActivation,
  RecentlyIssuedLicense,
  RegisterReleaseInput,
  RegisterReleaseResult,
  ReleaseDetail,
  SeatUtilization,
  SelfLicenseStatus,
  TierAStatus,
  UpdateLicenseTermsInput,
  UpdateLicenseTermsResult,
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

/**
 * Under MULTI_TENANT, a missing `tenantApiKey` is a hard error, never a
 * silent fallback to the global admin key (SaaS-B2, per F8's own
 * warning: "a single missed call site silently operates as the
 * superuser across all tenants, with correct-looking output"). Under
 * self-hosted, `tenantApiKey` is never passed at all, and this reads
 * LICENSE_ADMIN_API_KEY exactly as it always has.
 */
function resolveApiKey(tenantApiKey?: string): string {
  if (isMultiTenant()) {
    if (!tenantApiKey) {
      throw new Error('MULTI_TENANT is enabled but no tenantApiKey was provided - refusing to use the global admin key');
    }
    return tenantApiKey;
  }

  const key = process.env.LICENSE_ADMIN_API_KEY?.trim();
  if (!key) {
    throw new Error('Missing required environment variable: LICENSE_ADMIN_API_KEY');
  }
  return key;
}

// Beta-readiness finding: with no timeout, a hung or slow license-server
// response left the console request hanging indefinitely with no
// feedback - the page just spun forever. 15s is generous for any of this
// client's calls (all single-record reads/writes, none paginated beyond
// the backend's own 1000-row cap) while still turning a genuinely dead
// backend into a prompt, catchable error instead of an open-ended hang.
const REQUEST_TIMEOUT_MS = 15_000;

async function liveFetch(path: string, init: RequestInit = {}, tenantApiKey?: string): Promise<Response> {
  return fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${resolveApiKey(tenantApiKey)}`,
      ...init.headers,
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

// Shared by every !res.ok branch below - preserves the server's own
// error text for every 403 (not just issue-license's quota/payment
// cases, which is where this started - SaaS-B4), 400 (round-4
// independent review, finding F4: register-release.js's own 400
// rejections - the reserved-prefix guard and the artifact_url scheme
// check - were both added in round 2/3, but this function only
// special-cased 403 at the time, so lib/errors.ts's own
// isReservedProductId() classifier (which matches on the exact 400
// body text) could never actually see it - every 400 fell into the
// generic `Failed to X: 400 Bad Request` fallback below, indistinguishable
// from any other failure, even though the classifier + UI copy for it
// already existed), and 409 (round-5 independent review, finding F5-6:
// register-release.js's own duplicate-release rejection, added in round
// 4 - the same "classifier exists, body never reaches it" gap as F4,
// just on a status this function had never special-cased at all).
// lib/errors.ts's isOverQuota()/isPaymentFailed()/isTenantRejected()/
// isReservedProductId()/isDuplicateRelease()/isInvalidArtifactUrl()/
// isReleaseNotesTooLong()/isReleaseLimitReached() all classify by
// matching this exact message text, and none of them work without it -
// the generic fallback below (used for every other status, and for a
// 403/400/409 whose body doesn't parse) carries no classifiable
// information on purpose, since it's not one of the known,
// specifically-handled cases. unpublishRelease's own 409 (meaning
// "already unpublished," treated as a success) never reaches this
// function - see that route's own `res.status !== 409` guard - so
// widening this set doesn't change that route's behavior.
async function throwForFailedResponse(res: Response, fallbackMessage: string): Promise<never> {
  if (res.status === 403 || res.status === 400 || res.status === 409) {
    const body: { error?: string } = await res.json().catch(() => ({}));
    throw new LicenseApiError(body.error || res.statusText, res.status);
  }
  throw new LicenseApiError(`${fallbackMessage}: ${res.status} ${res.statusText}`, res.status);
}

async function fetchRawLicenses(
  params: {
    status?: 'active' | 'revoked';
    product_id?: string;
    issued_to?: string;
    key?: string;
    sort?: LicenseSortColumn;
    order?: 'asc' | 'desc';
    limit: number;
    offset: number;
  },
  tenantApiKey?: string
): Promise<{ licenses: RawLicenseListRow[]; total: number }> {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.product_id) query.set('product_id', params.product_id);
  if (params.issued_to) query.set('issued_to', params.issued_to);
  if (params.key) query.set('key', params.key);
  if (params.sort) query.set('sort', params.sort);
  if (params.order) query.set('order', params.order);
  query.set('limit', String(params.limit));
  query.set('offset', String(params.offset));

  const res = await liveFetch(`/list-licenses?${query.toString()}`, {}, tenantApiKey);
  if (!res.ok) {
    await throwForFailedResponse(res, 'Failed to list licenses');
  }
  return res.json();
}

// getExpiringLicenses and getLicensesNearSeatLimit both need every active
// license (there's no server-side way to ask for just "expiring soon" or
// "near its seat limit" - see the module docblock), and the dashboard page
// calls both in the same render. Without this, that's the same broad
// GET /list-licenses fetch made twice per dashboard load, on top of an
// already-restrictive per-IP admin rate limit. cache() (React's
// per-request-render memoization) now keys on `tenantApiKey` - deliberate,
// not incidental: without it, this would be exactly the cross-tenant
// cache-poisoning risk F8 flagged (tenant A's render could serve tenant
// B's cached broad-fetch result). A plain string argument compares by
// value, so this doesn't reintroduce the referential-inequality risk the
// original no-args design was written to avoid.
const getBroadActiveLicenses = cache(async (tenantApiKey?: string): Promise<RawLicenseListRow[]> => {
  const { licenses } = await fetchRawLicenses(
    {
      status: 'active',
      limit: BROAD_FETCH_LIMIT,
      offset: 0,
    },
    tenantApiKey
  );
  return licenses;
});

export async function listLicenses(
  params: ListLicensesParams = {},
  tenantApiKey?: string
): Promise<ListLicensesResult> {
  const { status, product_id, issued_to, key, sort, order, limit = 10, offset = 0 } = params;
  const { licenses, total } = await fetchRawLicenses(
    { status, product_id, issued_to, key, sort, order, limit, offset },
    tenantApiKey
  );

  return {
    licenses: licenses.map((license) => ({
      ...license,
      activations_used: license.activations_count,
    })),
    total,
  };
}

export async function getLicense(key: string, tenantApiKey?: string): Promise<License | null> {
  const res = await liveFetch(`/admin/license/${encodeURIComponent(key)}`, {}, tenantApiKey);
  if (res.status === 404) return null;
  if (!res.ok) {
    await throwForFailedResponse(res, 'Failed to get license');
  }
  return res.json();
}

export async function issueLicense(
  input: IssueLicenseInput,
  tenantApiKey?: string
): Promise<{ key: string }> {
  const res = await liveFetch(
    '/issue-license',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
    tenantApiKey
  );
  if (!res.ok) {
    await throwForFailedResponse(res, 'Failed to issue license');
  }
  const data: { key: string } = await res.json();
  return { key: data.key };
}

export async function setLicenseRevoked(
  key: string,
  revoked: boolean,
  tenantApiKey?: string
): Promise<void> {
  const res = await liveFetch(
    '/revoke-license',
    {
      method: 'POST',
      body: JSON.stringify({ key, revoked }),
    },
    tenantApiKey
  );
  // 409 means the license is already in the desired state - treat as a
  // successful no-op rather than an error, since the end result (the
  // license's status matches what was requested) is the same either way.
  if (!res.ok && res.status !== 409) {
    await throwForFailedResponse(res, 'Failed to update license status');
  }
}

export async function updateLicenseTerms(
  input: UpdateLicenseTermsInput,
  tenantApiKey?: string
): Promise<UpdateLicenseTermsResult> {
  const res = await liveFetch(
    '/admin/update-license-terms',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
    tenantApiKey
  );
  if (!res.ok) {
    await throwForFailedResponse(res, 'Failed to update license terms');
  }
  return res.json();
}

export async function updateLicenseNotes(key: string, notes: string, tenantApiKey?: string): Promise<void> {
  const res = await liveFetch(
    '/admin/update-notes',
    {
      method: 'POST',
      body: JSON.stringify({ key, notes }),
    },
    tenantApiKey
  );
  if (!res.ok) {
    await throwForFailedResponse(res, 'Failed to update license notes');
  }
}

export async function deleteLicense(key: string, tenantApiKey?: string): Promise<boolean> {
  const res = await liveFetch(
    '/delete-license',
    {
      method: 'DELETE',
      body: JSON.stringify({ key }),
    },
    tenantApiKey
  );
  if (res.status === 404) return false;
  if (!res.ok) {
    await throwForFailedResponse(res, 'Failed to delete license');
  }
  return true;
}

export async function listActivations(key: string, tenantApiKey?: string): Promise<Activation[]> {
  const res = await liveFetch(`/list-activations/${encodeURIComponent(key)}`, {}, tenantApiKey);
  if (res.status === 404) return [];
  if (!res.ok) {
    await throwForFailedResponse(res, 'Failed to list activations');
  }
  const data: { key: string; activations: Activation[] } = await res.json();
  return data.activations;
}

export async function reissueActivationToken(
  key: string,
  instanceId: string,
  tenantApiKey?: string
): Promise<{ token: string } | null> {
  const res = await liveFetch(
    '/admin/reissue-token',
    {
      method: 'POST',
      body: JSON.stringify({ key, instance_id: instanceId }),
    },
    tenantApiKey
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    await throwForFailedResponse(res, 'Failed to reissue activation token');
  }
  const data: { reissued: boolean; token: string } = await res.json();
  return { token: data.token };
}

export async function deactivateByInstanceId(
  key: string,
  instanceId: string,
  tenantApiKey?: string
): Promise<boolean | null> {
  const res = await liveFetch(
    '/admin/deactivate-by-instance-id',
    {
      method: 'POST',
      body: JSON.stringify({ key, instance_id: instanceId }),
    },
    tenantApiKey
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    await throwForFailedResponse(res, 'Failed to deactivate activation');
  }
  const data: { deactivated: boolean } = await res.json();
  return data.deactivated;
}

export async function getDashboardStats(tenantApiKey?: string): Promise<DashboardStats> {
  const res = await liveFetch('/admin/stats', {}, tenantApiKey);
  if (!res.ok) {
    await throwForFailedResponse(res, 'Failed to get dashboard stats');
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

export async function getRecentActivations(limit = 5, tenantApiKey?: string): Promise<RecentActivation[]> {
  const res = await liveFetch(`/recent-activations?limit=${limit}`, {}, tenantApiKey);
  if (!res.ok) {
    await throwForFailedResponse(res, 'Failed to get recent activations');
  }
  return res.json();
}

export async function getExpiringLicenses(
  withinDays = 30,
  limit = 5,
  tenantApiKey?: string
): Promise<ExpiringLicense[]> {
  const licenses = await getBroadActiveLicenses(tenantApiKey);

  const now = Date.now();
  const cutoff = now + withinDays * 24 * 60 * 60 * 1000;

  return licenses
    // A perpetual license (expires_at: null) can never be "expiring
    // soon" by definition - excluded here explicitly rather than relying
    // on new Date(null) coincidentally producing the epoch (independent-
    // review finding: expires_at is genuinely nullable now, and this
    // function's own return type promises a real string per license).
    .filter((license): license is typeof license & { expires_at: string } => license.expires_at !== null)
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

export async function getLicensesNearSeatLimit(
  limit = 5,
  tenantApiKey?: string
): Promise<SeatUtilization[]> {
  const licenses = await getBroadActiveLicenses(tenantApiKey);

  return licenses
    // A license with unlimited seats (max_activations: null - reachable
    // since the license-terms edit route can set it) is never "near its
    // seat limit," because it has none - excluded here explicitly rather
    // than relying on `null - number` producing NaN and NaN <= 1 always
    // being false.
    .filter((license): license is typeof license & { max_activations: number } => license.max_activations !== null)
    .map((license) => ({
      key: license.key,
      product_id: license.product_id,
      tier: license.tier,
      used: license.activations_count,
      max_activations: license.max_activations,
      remaining: license.max_activations - license.activations_count,
    }))
    .filter((entry) => entry.remaining <= 1)
    .sort((a, b) => a.remaining - b.remaining)
    .slice(0, limit);
}

export async function getRecentlyIssuedLicenses(
  limit = 5,
  tenantApiKey?: string
): Promise<RecentlyIssuedLicense[]> {
  // No broad fetch needed here, unlike the two functions above: the real
  // GET /list-licenses already defaults to ORDER BY issued_at DESC, so
  // asking for exactly `limit` rows already gives the most recently
  // issued licenses in the right order.
  const { licenses } = await fetchRawLicenses({ limit, offset: 0 }, tenantApiKey);

  return licenses.map(({ key, product_id, tier, issued_to, issued_at }) => ({
    key,
    product_id,
    tier,
    issued_to,
    issued_at,
  }));
}

// SaaS-B4: casazium/license's new tenant-scoped self-service billing
// routes (GET /billing/status, POST /billing/checkout) - unlike every
// function above, these are only ever meaningful under MULTI_TENANT
// (self-hosted has no billing concept), but still routed through the
// same live/mock dispatch as everything else for standalone-mode
// consistency (getBackendMode() decides live vs. mock, not
// isMultiTenant() - see license-client.ts).
export async function getBillingStatus(tenantApiKey?: string): Promise<BillingStatus> {
  const res = await liveFetch('/billing/status', {}, tenantApiKey);
  if (!res.ok) {
    await throwForFailedResponse(res, 'Failed to get billing status');
  }
  return res.json();
}

export async function createCheckoutSession(plan: string, tenantApiKey?: string): Promise<{ url: string }> {
  const res = await liveFetch(
    '/billing/checkout',
    {
      method: 'POST',
      body: JSON.stringify({ plan }),
    },
    tenantApiKey
  );
  if (!res.ok) {
    await throwForFailedResponse(res, 'Failed to create checkout session');
  }
  return res.json();
}

// Demo-only counterpart to createCheckoutSession above - completes the
// in-app stub checkout confirmation page's flow by hitting
// POST /billing/complete-stub-checkout, which does what a real Stripe
// webhook eventually would. Only meaningful while BILLING_PROVIDER=stub
// server-side; that route itself 404s otherwise.
export async function completeStubCheckout(plan: string, tenantApiKey?: string): Promise<BillingStatus> {
  const res = await liveFetch(
    '/billing/complete-stub-checkout',
    {
      method: 'POST',
      body: JSON.stringify({ plan }),
    },
    tenantApiKey
  );
  if (!res.ok) {
    await throwForFailedResponse(res, 'Failed to complete stub checkout');
  }
  return res.json();
}

// Self-service hard account deletion (BETA_LAUNCH_STATUS.md §4) -
// DELETE /v1/delete-account (casazium/license's own
// src/routes/delete-tenant-account.js). Permanent, no grace period - the
// server-side route purges the tenant's license_keys/activations/
// tenant_auth_log/billing_subscriptions/product_ownership and the tenant
// row itself in one transaction. The caller (deleteAccountAction) is
// responsible for the console's own local cleanup afterward (its
// accounts/tenant_branding rows, session revocation) - this function only
// covers the license-server side.
export async function deleteAccount(tenantApiKey?: string): Promise<void> {
  // Empty string, not omitted - liveFetch() always sets
  // Content-Type: application/json (every other export needs it), and
  // Fastify's default JSON body parser 400s on an empty body whenever
  // that header is present, regardless of whether the route itself
  // requires one. Confirmed live: the route has no body schema at all,
  // but the request never reached it without this.
  const res = await liveFetch('/delete-account', { method: 'DELETE', body: '{}' }, tenantApiKey);
  if (!res.ok) {
    await throwForFailedResponse(res, 'Failed to delete account');
  }
}

// BETA_LAUNCH_STATUS.md §4, API-key-rotation gap: mints a fresh tenant
// key and retires the old one in the same operation (hard cutover, no
// overlap window - operator decision). Authenticated with the *current*
// key, same as every other tenant-scoped call - the caller
// (rotateApiKeyAction) is responsible for re-encrypting the returned key
// into this console's own accounts.tenant_api_key_encrypted afterward,
// or the console's own stored copy goes stale the instant this succeeds.
export async function rotateApiKey(tenantApiKey?: string): Promise<{ apiKey: string }> {
  // Empty string, not omitted - same liveFetch()/empty-body-schema gotcha
  // as deleteAccount() above.
  const res = await liveFetch('/rotate-api-key', { method: 'POST', body: '{}' }, tenantApiKey);
  if (!res.ok) {
    await throwForFailedResponse(res, 'Failed to rotate API key');
  }
  return res.json();
}

// Beta-testing visibility indicator - GET /v1/self-license/status
// (casazium/license's src/routes/self-license-status.js). Whole-instance
// state, not tenant-scoped data, but keeps the same trailing
// `tenantApiKey` signature as every export above for consistency -
// resolveApiKey() already does the right thing with it either way.
export async function getSelfLicenseStatus(tenantApiKey?: string): Promise<SelfLicenseStatus> {
  const res = await liveFetch('/self-license/status', {}, tenantApiKey);
  if (!res.ok) {
    await throwForFailedResponse(res, 'Failed to get self-license status');
  }
  return res.json();
}

// Tier-A activation-license expiry, for the dashboard's countdown/expired
// badge - GET /v1/admin/tier-a-status (casazium/license's
// src/routes/admin-tier-a-status.js). Same "whole-instance state, not
// tenant-scoped" shape as getSelfLicenseStatus above.
export async function getTierAStatus(tenantApiKey?: string): Promise<TierAStatus> {
  const res = await liveFetch('/admin/tier-a-status', {}, tenantApiKey);
  if (!res.ok) {
    await throwForFailedResponse(res, 'Failed to get Tier-A license status');
  }
  return res.json();
}

// Software Distribution - GET /v1/list-releases (casazium/license's
// src/routes/list-releases.js). Same tenant-scoped list shape as
// listLicenses above; no client-side broad-fetch derivation needed since
// this feature has no dashboard-summary use yet.
export async function listReleases(
  params: ListReleasesParams = {},
  tenantApiKey?: string
): Promise<ListReleasesResult> {
  const { product_id, channel, platform, status, limit = 50, offset = 0 } = params;
  const query = new URLSearchParams();
  if (product_id) query.set('product_id', product_id);
  if (channel) query.set('channel', channel);
  if (platform) query.set('platform', platform);
  if (status) query.set('status', status);
  query.set('limit', String(limit));
  query.set('offset', String(offset));

  const res = await liveFetch(`/list-releases?${query.toString()}`, {}, tenantApiKey);
  if (!res.ok) {
    await throwForFailedResponse(res, 'Failed to list releases');
  }
  return res.json();
}

// POST /v1/register-release (casazium/license's
// src/routes/register-release.js) - 403s with 'product_id is owned by a
// different tenant' on a collision, surfaced via LicenseApiError the same
// way issueLicense's own product_id conflict is (lib/errors.ts's
// isProductIdTaken() matches this exact message text).
export async function registerRelease(
  input: RegisterReleaseInput,
  tenantApiKey?: string
): Promise<RegisterReleaseResult> {
  const res = await liveFetch(
    '/register-release',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
    tenantApiKey
  );
  if (!res.ok) {
    await throwForFailedResponse(res, 'Failed to register release');
  }
  return res.json();
}

// POST /v1/unpublish-release (casazium/license's
// src/routes/unpublish-release.js) - 409 means already unpublished,
// treated as a successful no-op, same reasoning as setLicenseRevoked
// above.
export async function unpublishRelease(id: number, tenantApiKey?: string): Promise<void> {
  const res = await liveFetch(
    '/unpublish-release',
    {
      method: 'POST',
      body: JSON.stringify({ id }),
    },
    tenantApiKey
  );
  if (!res.ok && res.status !== 409) {
    await throwForFailedResponse(res, 'Failed to unpublish release');
  }
}

// GET /v1/release/:id (casazium/license's src/routes/admin-release.js,
// added round-3 independent review finding C-2). list-releases.js's own
// per-row payload already includes artifact_url/checksum/release_notes
// (only `signature` is list-only-omitted) - this route exists for the
// same reason getLicense() exists alongside listLicenses(): a stable,
// single-row fetch by id for a detail page/route, not a substitute for
// paging/filtering the list. null on a 404, mirroring getLicense()'s own
// convention - the caller can't tell "never existed" from "belongs to a
// different tenant" anyway, matching unpublish-release.js's own
// information-hiding behavior.
export async function getRelease(id: number, tenantApiKey?: string): Promise<ReleaseDetail | null> {
  const res = await liveFetch(`/release/${id}`, {}, tenantApiKey);
  if (res.status === 404) return null;
  if (!res.ok) {
    await throwForFailedResponse(res, 'Failed to get release');
  }
  return res.json();
}
