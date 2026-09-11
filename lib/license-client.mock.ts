/**
 * MOCK license-server client - in-memory data, no HTTP calls. Used for
 * standalone (look-and-feel-only) mode - see license-client.ts's mode
 * dispatcher. State resets whenever the dev server process restarts.
 */

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
  RecentActivation,
  RecentlyIssuedLicense,
  RegisterReleaseInput,
  RegisterReleaseResult,
  Release,
  ReleaseDetail,
  SeatUtilization,
  SelfLicenseStatus,
  TierAStatus,
  UpdateLicenseTermsInput,
  UpdateLicenseTermsResult,
} from './license-types';

type Store = {
  licenses: License[];
  activations: Record<string, Activation[]>;
  releases: Release[];
};

const globalForMockStore = globalThis as unknown as { __licenseMockStore?: Store };

function seedStore(): Store {
  const synthetic = generateSyntheticLicenses(24);

  return {
    licenses: [
      {
        key: 'CASZ-DEMO-ALPHA-0001',
        product_id: 'widget-pro',
        tier: 'pro',
        status: 'active',
        issued_to: 'demo-customer@example.com',
        issued_at: '2026-06-01T00:00:00Z',
        expires_at: '2027-06-01T00:00:00Z',
        limits: { api_calls_per_day: 10000 },
        usage: { api_calls_per_day: 421 },
        max_activations: 3,
        revoked_at: null,
        notes: 'Enterprise pilot - upgraded from trial 2026-05-20',
      },
      {
        key: 'CASZ-DEMO-BETA-0002',
        product_id: 'widget-pro',
        tier: 'starter',
        status: 'active',
        issued_to: 'another-customer@example.com',
        issued_at: '2026-05-15T00:00:00Z',
        expires_at: '2026-11-15T00:00:00Z',
        limits: { api_calls_per_day: 1000 },
        usage: { api_calls_per_day: 998 },
        max_activations: 1,
        revoked_at: null,
        notes: null,
      },
      {
        key: 'CASZ-DEMO-GAMMA-0003',
        product_id: 'widget-lite',
        tier: 'trial',
        status: 'revoked',
        issued_to: 'churned-customer@example.com',
        issued_at: '2026-03-01T00:00:00Z',
        expires_at: '2026-04-01T00:00:00Z',
        limits: { api_calls_per_day: 100 },
        usage: { api_calls_per_day: 100 },
        max_activations: 1,
        revoked_at: '2026-04-02T00:00:00Z',
        notes: 'Churned - non-payment. Do not renew without finance sign-off.',
      },
      {
        // Demonstrates the "expiring soon" dashboard widget - relative to
        // whenever this seed runs, not a fixed past date like the others.
        key: 'CASZ-DEMO-DELTA-0004',
        product_id: 'widget-pro',
        tier: 'pro',
        status: 'active',
        issued_to: 'renewal-due-customer@example.com',
        issued_at: '2025-08-01T00:00:00Z',
        expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        limits: { api_calls_per_day: 5000 },
        usage: { api_calls_per_day: 3120 },
        max_activations: 2,
        revoked_at: null,
        notes: null,
      },
      ...synthetic.licenses,
    ],
    activations: {
      'CASZ-DEMO-ALPHA-0001': [
        { instance_id: 'inst_7f3a9c2e', activated_at: '2026-06-02T09:14:00Z' },
        { instance_id: 'inst_1b8d4f6a', activated_at: '2026-06-10T17:42:00Z' },
      ],
      'CASZ-DEMO-BETA-0002': [
        { instance_id: 'inst_9e2c5a1d', activated_at: '2026-05-16T11:03:00Z' },
      ],
      'CASZ-DEMO-DELTA-0004': [
        { instance_id: 'inst_4c8e2f91', activated_at: '2025-08-02T10:00:00Z' },
      ],
      ...synthetic.activations,
    },
    releases: [
      {
        id: 1,
        product_id: 'widget-pro',
        version: '2.3.0',
        channel: 'stable',
        platform: 'darwin-arm64',
        artifact_url: 'https://cdn.example.com/widget-pro/2.3.0/widget-pro-mac.dmg',
        checksum: 'sha256:0000000000000000000000000000000000000000000000000000000000aa',
        release_notes: 'Fixes a rare crash on startup.',
        status: 'published',
        created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      },
      {
        id: 2,
        product_id: 'widget-pro',
        version: '2.2.1',
        channel: 'stable',
        platform: 'darwin-arm64',
        artifact_url: 'https://cdn.example.com/widget-pro/2.2.1/widget-pro-mac.dmg',
        checksum: 'sha256:0000000000000000000000000000000000000000000000000000000000bb',
        release_notes: null,
        status: 'unpublished',
        created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ],
  };
}

// Beyond the 4 hand-authored demo licenses above, generates enough
// additional licenses that pagination/filtering/sorting are genuinely
// demonstrable and testable during verification - not just theoretically
// wired against a 4-row dataset that fits on one page regardless.
function generateSyntheticLicenses(count: number): { licenses: License[]; activations: Store['activations'] } {
  const products = ['widget-pro', 'widget-lite', 'gadget-basic'];
  const tiers = ['starter', 'pro', 'enterprise'];
  const licenses: License[] = [];
  const activations: Store['activations'] = {};
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  for (let i = 0; i < count; i += 1) {
    const key = `CASZ-SYN-${String(i + 1).padStart(4, '0')}`;
    const maxActivations = 1 + (i % 5);
    const used = i % (maxActivations + 1);
    const revoked = i % 7 === 0;
    const issuedAt = now - (i * 11 + 5) * day;
    // Spread expirations across a wide range, including some inside the
    // dashboard's 30-day "expiring soon" window, so that widget and this
    // page's filters exercise overlapping, realistic data.
    const expiresAt = now + ((i * 13) % 400 - 60) * day;

    licenses.push({
      key,
      product_id: products[i % products.length],
      tier: tiers[i % tiers.length],
      status: revoked ? 'revoked' : 'active',
      issued_to: `customer-${i + 1}@example.com`,
      issued_at: new Date(issuedAt).toISOString(),
      expires_at: new Date(expiresAt).toISOString(),
      limits: { api_calls_per_day: 1000 * (1 + (i % 10)) },
      usage: { api_calls_per_day: 50 * (i % 20) },
      max_activations: maxActivations,
      revoked_at: revoked ? new Date(issuedAt + 2 * day).toISOString() : null,
      notes: i % 5 === 0 ? 'Sample note - resold via reseller partner' : null,
    });

    if (used > 0) {
      activations[key] = Array.from({ length: used }, (_, seat) => ({
        instance_id: `inst_syn${i}${seat}`,
        activated_at: new Date(issuedAt + (seat + 1) * day).toISOString(),
      }));
    }
  }

  return { licenses, activations };
}

function getStore(): Store {
  if (!globalForMockStore.__licenseMockStore) {
    globalForMockStore.__licenseMockStore = seedStore();
  }
  return globalForMockStore.__licenseMockStore;
}

function generateKey(): string {
  const segment = () =>
    Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, 'X');
  return `CASZ-${segment()}-${segment()}-${segment()}`;
}

// 3-way comparator per sortable column, mirroring the real backend's
// ORDER BY behavior (casazium/license's src/routes/list-licenses.js) as
// closely as an in-memory JS sort can:
// - Array.prototype.sort has been a *stable* sort since ES2019, so a
//   comparator that correctly returns 0 on ties preserves this array's
//   existing relative order for tied rows - the same role the real
//   route's explicit `, id ASC` tiebreaker plays server-side (this
//   store's licenses array is itself insertion-ordered, so relative
//   order here already tracks "which was added first").
// - expires_at is nullable (perpetual license) - sorts last regardless
//   of direction, matching the server's explicit `(expires_at IS NULL)
//   ASC` tiebreak-before-the-real-comparison, not a plain `<`/`>` on
//   `null` (which JS coerces in ways that don't match SQL NULL
//   semantics at all).
// - Every other sortable column is plain ASCII-ish text (keys, emails,
//   status/tier/product_id tokens) or a number, where JS's default `<`/
//   `>` and SQLite's BINARY collation agree closely enough for admin
//   tooling; not verified byte-for-byte equivalent for arbitrary
//   Unicode.
// 'issued_at' is the real backend's default sort target when no `sort`
// param is given at all, but it isn't in LicenseSortColumn (the public
// wire-facing enum) - not offered as an explicit `sort` value, matching
// list-licenses.js's own SORTABLE_COLUMNS comment.
type MockSortColumn = LicenseSortColumn | 'issued_at';

function compareLicenses(
  a: License & { activations_used: number },
  b: License & { activations_used: number },
  column: MockSortColumn,
  direction: 'asc' | 'desc'
): number {
  const factor = direction === 'asc' ? 1 : -1;

  if (column === 'expires_at') {
    if (a.expires_at === null && b.expires_at === null) return 0;
    if (a.expires_at === null) return 1;
    if (b.expires_at === null) return -1;
    return a.expires_at < b.expires_at ? -1 * factor : a.expires_at > b.expires_at ? 1 * factor : 0;
  }

  const aValue = column === 'activations_count' ? a.activations_used : a[column];
  const bValue = column === 'activations_count' ? b.activations_used : b[column];
  if (aValue < bValue) return -1 * factor;
  if (aValue > bValue) return 1 * factor;
  return 0;
}

export async function listLicenses(
  params: ListLicensesParams = {},
  // SaaS-B2: accepted for signature parity with license-client.live.ts
  // (license-client.ts's dispatcher types every export as `typeof
  // mock.xxx`) - unused here, mock mode has no real tenant concept.
  _tenantApiKey?: string
): Promise<ListLicensesResult> {
  const { status, product_id, issued_to, key, sort, order = 'desc', limit = 10, offset = 0 } = params;
  const { licenses, activations } = getStore();

  const withUsage = licenses.map((license) => ({
    ...license,
    activations_used: activations[license.key]?.length ?? 0,
  }));

  const filtered = withUsage.filter((license) => {
    if (status && license.status !== status) return false;
    if (product_id && license.product_id !== product_id) return false;
    // Mirrors the real backend's case-insensitive substring match (see
    // casazium/license's src/routes/list-licenses.js) - no wildcard
    // escaping needed here since this is a plain substring check, not SQL.
    if (issued_to && !license.issued_to.toLowerCase().includes(issued_to.toLowerCase())) return false;
    if (key && !license.key.toLowerCase().includes(key.toLowerCase())) return false;
    return true;
  });

  // Matches the real GET /list-licenses's own default `ORDER BY
  // issued_at DESC` when no sort is requested.
  const sortColumn: MockSortColumn = sort ?? 'issued_at';
  const sorted = [...filtered].sort((a, b) => compareLicenses(a, b, sortColumn, order));

  const page = sorted.slice(offset, offset + limit);

  return { licenses: page, total: sorted.length };
}

export async function getLicense(key: string, _tenantApiKey?: string): Promise<License | null> {
  return getStore().licenses.find((license) => license.key === key) ?? null;
}

export async function issueLicense(
  input: IssueLicenseInput,
  _tenantApiKey?: string
): Promise<{ key: string }> {
  const license: License = {
    key: generateKey(),
    product_id: input.product_id,
    tier: input.tier,
    status: 'active',
    issued_to: input.issued_to,
    issued_at: new Date().toISOString(),
    expires_at: input.expires_at,
    limits: input.limits ?? {},
    usage: {},
    max_activations: input.max_activations,
    revoked_at: null,
    notes: input.notes || null,
  };
  getStore().licenses.push(license);
  return { key: license.key };
}

export async function updateLicenseTerms(
  input: UpdateLicenseTermsInput,
  _tenantApiKey?: string
): Promise<UpdateLicenseTermsResult> {
  const license = getStore().licenses.find((entry) => entry.key === input.key);
  if (!license) {
    throw new Error('License key not found');
  }
  // Same "only provided fields change" semantics as the real backend -
  // Object.hasOwn, not truthiness, so expires_at: null / max_activations:
  // null are real signals (perpetual / unlimited seats), not "absent".
  if (Object.hasOwn(input, 'expires_at')) {
    license.expires_at = input.expires_at ?? null;
  }
  if (Object.hasOwn(input, 'max_activations')) {
    license.max_activations = input.max_activations ?? null;
  }
  if (Object.hasOwn(input, 'limits')) {
    license.limits = input.limits ?? {};
  }

  const activationsCount = getStore().activations[license.key]?.length ?? 0;

  return {
    key: license.key,
    expires_at: license.expires_at,
    limits: license.limits,
    max_activations: license.max_activations,
    usage: license.usage,
    status: license.status,
    activations_count: activationsCount,
  };
}

export async function setLicenseRevoked(
  key: string,
  revoked: boolean,
  _tenantApiKey?: string
): Promise<void> {
  const license = getStore().licenses.find((entry) => entry.key === key);
  if (!license) return;
  license.status = revoked ? 'revoked' : 'active';
  license.revoked_at = revoked ? new Date().toISOString() : null;
}

export async function updateLicenseNotes(
  key: string,
  notes: string,
  _tenantApiKey?: string
): Promise<void> {
  const license = getStore().licenses.find((entry) => entry.key === key);
  if (!license) return;
  license.notes = notes || null;
}

export async function deleteLicense(key: string, _tenantApiKey?: string): Promise<boolean> {
  const store = getStore();
  const index = store.licenses.findIndex((entry) => entry.key === key);
  if (index === -1) return false;
  store.licenses.splice(index, 1);
  delete store.activations[key];
  return true;
}

export async function listActivations(key: string, _tenantApiKey?: string): Promise<Activation[]> {
  return getStore().activations[key] ?? [];
}

export async function reissueActivationToken(
  key: string,
  instanceId: string,
  _tenantApiKey?: string
): Promise<{ token: string } | null> {
  const activations = getStore().activations[key];
  if (!activations?.some((activation) => activation.instance_id === instanceId)) {
    return null;
  }
  return { token: `reissued_${Math.random().toString(36).slice(2, 10)}` };
}

export async function deactivateByInstanceId(
  key: string,
  instanceId: string,
  _tenantApiKey?: string
): Promise<boolean | null> {
  const activations = getStore().activations[key];
  const index = activations?.findIndex((activation) => activation.instance_id === instanceId) ?? -1;
  if (index === -1) return null;
  activations!.splice(index, 1);
  return true;
}

// Mock counterpart to the live client's hard-delete. Not actually
// reachable through the UI in standalone mode (the Settings page's
// delete-account section only renders when tenantApiKey is set, which
// standalone/mock mode never has - MULTI_TENANT signup provisions a real
// tenant, no mock equivalent, per this repo's README). Kept for type
// parity with the live/dispatcher trio and in case a future test wants
// to exercise it directly.
export async function deleteAccount(_tenantApiKey?: string): Promise<void> {
  const store = getStore();
  store.licenses.length = 0;
  for (const key of Object.keys(store.activations)) {
    delete store.activations[key];
  }
}

// Mock counterpart to the live client's rotateApiKey(). Not reachable
// through the UI in standalone mode either, same reasoning as
// deleteAccount() above - kept for type parity.
export async function rotateApiKey(_tenantApiKey?: string): Promise<{ apiKey: string }> {
  return { apiKey: `mock-${crypto.randomUUID()}` };
}

export async function getDashboardStats(_tenantApiKey?: string): Promise<DashboardStats> {
  const { licenses, activations } = getStore();
  return {
    active_licenses: licenses.filter((license) => license.status === 'active').length,
    active_activations: Object.values(activations).reduce((sum, list) => sum + list.length, 0),
    revoked_licenses: licenses.filter((license) => license.status === 'revoked').length,
  };
}

export async function getRecentActivations(
  limit = 5,
  _tenantApiKey?: string
): Promise<RecentActivation[]> {
  const { activations } = getStore();
  const flattened: RecentActivation[] = Object.entries(activations).flatMap(([key, list]) =>
    list.map((activation) => ({ key, ...activation }))
  );
  return flattened
    .sort((a, b) => (a.activated_at < b.activated_at ? 1 : -1))
    .slice(0, limit);
}

export async function getExpiringLicenses(
  withinDays = 30,
  limit = 5,
  _tenantApiKey?: string
): Promise<ExpiringLicense[]> {
  const { licenses } = getStore();
  const now = Date.now();
  const cutoff = now + withinDays * 24 * 60 * 60 * 1000;

  return licenses
    .filter((license) => license.status === 'active')
    // A perpetual license (expires_at: null) can never be "expiring
    // soon" - same reasoning as license-client.live.ts's own filter.
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
  _tenantApiKey?: string
): Promise<SeatUtilization[]> {
  const { licenses, activations } = getStore();

  return licenses
    .filter((license) => license.status === 'active')
    // A license with unlimited seats (max_activations: null) is never
    // "near its seat limit" - same reasoning as license-client.live.ts's
    // own filter.
    .filter((license): license is typeof license & { max_activations: number } => license.max_activations !== null)
    .map((license) => {
      const used = activations[license.key]?.length ?? 0;
      return {
        key: license.key,
        product_id: license.product_id,
        tier: license.tier,
        used,
        max_activations: license.max_activations,
        remaining: license.max_activations - used,
      };
    })
    .filter((entry) => entry.remaining <= 1)
    .sort((a, b) => a.remaining - b.remaining)
    .slice(0, limit);
}

export async function getRecentlyIssuedLicenses(
  limit = 5,
  _tenantApiKey?: string
): Promise<RecentlyIssuedLicense[]> {
  const { licenses } = getStore();

  return [...licenses]
    .sort((a, b) => (a.issued_at < b.issued_at ? 1 : -1))
    .slice(0, limit)
    .map(({ key, product_id, tier, issued_to, issued_at }) => ({
      key,
      product_id,
      tier,
      issued_to,
      issued_at,
    }));
}

// SaaS-B4: mock equivalents so standalone/demo mode can also show the
// billing page's look and feel, matching this file's own purpose - real
// tenant billing state doesn't exist here, so a fixed demo value stands
// in (an "active, pro plan" tenant is a more useful/representative demo
// than an empty "no plan" one). licensesUsed derived from the real mock
// store's own active-license count (BETA_LAUNCH_STATUS.md §4,
// quota-visibility) rather than a second hardcoded number that could
// drift from what the licenses list actually shows.
export async function getBillingStatus(_tenantApiKey?: string): Promise<BillingStatus> {
  const licensesUsed = getStore().licenses.filter((license) => license.status === 'active').length;
  return { status: 'active', plan: 'pro', cancelAtPeriodEnd: false, currentPeriodEnd: null, licensesUsed, licenseLimit: 100 };
}

export async function createCheckoutSession(
  plan: string,
  _interval?: string,
  _tenantApiKey?: string
): Promise<{ url: string }> {
  return { url: `https://stub-billing.invalid/checkout/demo-tenant/${plan}` };
}

export async function completeStubCheckout(plan: string, _tenantApiKey?: string): Promise<BillingStatus> {
  const licensesUsed = getStore().licenses.filter((license) => license.status === 'active').length;
  return {
    status: 'active',
    plan,
    cancelAtPeriodEnd: false,
    currentPeriodEnd: null,
    licensesUsed,
    licenseLimit: plan === 'pro' ? 100 : 5,
  };
}

// Standalone/demo mode never runs against a real casazium/license
// backend, so there's no real Tier-A/Tier-B distinction to report - fixed
// 'tier-a' matches the common real-world case (most deployments aren't
// Tier-B) and keeps the dashboard's self-license indicator hidden in
// demo mode, same as it would be for any ordinary live Tier-A backend.
export async function getSelfLicenseStatus(_tenantApiKey?: string): Promise<SelfLicenseStatus> {
  return { tier: 'tier-a' };
}

// Standalone/demo mode never runs against a real casazium/license
// backend, so there's no real activation-license file to report on -
// 'internal' (the same reason Casazium's own hosted instances skip this
// gate) keeps the dashboard's Tier-A badge hidden in demo mode, same
// posture as getSelfLicenseStatus's own mock above.
export async function getTierAStatus(_tenantApiKey?: string): Promise<TierAStatus> {
  return { applicable: false, reason: 'internal' };
}

export async function listReleases(
  params: ListReleasesParams = {},
  _tenantApiKey?: string
): Promise<ListReleasesResult> {
  const { product_id, channel, platform, status, limit = 50, offset = 0 } = params;
  const { releases } = getStore();

  const filtered = releases.filter((release) => {
    if (product_id && release.product_id !== product_id) return false;
    if (channel && release.channel !== channel) return false;
    if (platform && release.platform !== platform) return false;
    if (status && release.status !== status) return false;
    return true;
  });

  // Matches the real GET /list-releases's own default `ORDER BY
  // created_at DESC, id DESC` - this store's releases array is itself
  // insertion-ordered, so a plain reverse-slice mirrors that without
  // needing a real comparator.
  const sorted = [...filtered].reverse();
  const page = sorted.slice(offset, offset + limit);

  return { releases: page, total: sorted.length };
}

// Mock mode has no real cross-tenant concept, so - unlike the live
// client - this never throws a product_id-ownership conflict; every
// registration in standalone mode is trivially "your own."
export async function registerRelease(
  input: RegisterReleaseInput,
  _tenantApiKey?: string
): Promise<RegisterReleaseResult> {
  const { releases } = getStore();
  const nextId = releases.reduce((max, r) => Math.max(max, r.id), 0) + 1;

  const release: Release = {
    id: nextId,
    product_id: input.product_id,
    version: input.version,
    channel: input.channel || 'stable',
    platform: input.platform,
    artifact_url: input.artifact_url,
    checksum: input.checksum,
    release_notes: input.release_notes || null,
    status: 'published',
    created_at: new Date().toISOString(),
  };
  releases.push(release);
  return { id: release.id, status: 'published' };
}

export async function unpublishRelease(id: number, _tenantApiKey?: string): Promise<void> {
  const release = getStore().releases.find((entry) => entry.id === id);
  if (!release) {
    throw new Error('Release not found');
  }
  release.status = 'unpublished';
}

// Added round-3 independent review, console finding C-2 (Releases detail
// page). `signature` isn't part of the mock store's own Release records
// (nothing in standalone mode ever verifies it) - a fixed placeholder
// string is enough to exercise the detail page's layout without
// pretending to be real cryptographic output.
export async function getRelease(id: number, _tenantApiKey?: string): Promise<ReleaseDetail | null> {
  const release = getStore().releases.find((entry) => entry.id === id);
  if (!release) return null;
  return { ...release, signature: 'mock-signature-not-cryptographically-real' };
}
