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
  ListLicensesParams,
  ListLicensesResult,
  RecentActivation,
  RecentlyIssuedLicense,
  SeatUtilization,
  SelfLicenseStatus,
} from './license-types';

type Store = {
  licenses: License[];
  activations: Record<string, Activation[]>;
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
        usage_limit: 10000,
        usage_count: 421,
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
        usage_limit: 1000,
        usage_count: 998,
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
        usage_limit: 100,
        usage_count: 100,
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
        usage_limit: 5000,
        usage_count: 3120,
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
      usage_limit: 1000 * (1 + (i % 10)),
      usage_count: 50 * (i % 20),
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

export async function listLicenses(
  params: ListLicensesParams = {},
  // SaaS-B2: accepted for signature parity with license-client.live.ts
  // (license-client.ts's dispatcher types every export as `typeof
  // mock.xxx`) - unused here, mock mode has no real tenant concept.
  _tenantApiKey?: string
): Promise<ListLicensesResult> {
  const { status, product_id, limit = 10, offset = 0 } = params;
  const { licenses, activations } = getStore();

  const filtered = licenses.filter((license) => {
    if (status && license.status !== status) return false;
    if (product_id && license.product_id !== product_id) return false;
    return true;
  });

  // Matches the real GET /list-licenses's own ORDER BY issued_at DESC -
  // that route has no sort parameter, so this is the only order the real
  // API can return regardless of what page/filter is requested.
  const sorted = [...filtered].sort((a, b) => (a.issued_at < b.issued_at ? 1 : -1));

  const page = sorted.slice(offset, offset + limit).map((license) => ({
    ...license,
    activations_used: activations[license.key]?.length ?? 0,
  }));

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
    usage_limit: null,
    usage_count: 0,
    max_activations: input.max_activations,
    revoked_at: null,
    notes: input.notes || null,
  };
  getStore().licenses.push(license);
  return { key: license.key };
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
// than an empty "no plan" one).
export async function getBillingStatus(_tenantApiKey?: string): Promise<BillingStatus> {
  return { status: 'active', plan: 'pro' };
}

export async function createCheckoutSession(
  plan: string,
  _tenantApiKey?: string
): Promise<{ url: string }> {
  return { url: `https://stub-billing.invalid/checkout/demo-tenant/${plan}` };
}

export async function completeStubCheckout(plan: string, _tenantApiKey?: string): Promise<BillingStatus> {
  return { status: 'active', plan };
}

// Standalone/demo mode never runs against a real casazium/license
// backend, so there's no real Tier-A/Tier-B distinction to report - fixed
// 'tier-a' matches the common real-world case (most deployments aren't
// Tier-B) and keeps the dashboard's self-license indicator hidden in
// demo mode, same as it would be for any ordinary live Tier-A backend.
export async function getSelfLicenseStatus(_tenantApiKey?: string): Promise<SelfLicenseStatus> {
  return { tier: 'tier-a' };
}
