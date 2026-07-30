/**
 * MOCK license-server client - in-memory data, no HTTP calls. Exists so the
 * UI can be built and played with before the real client (using
 * LICENSE_API_URL / LICENSE_ADMIN_API_KEY) is implemented. Function
 * signatures are meant to match what the real client will expose, so
 * swapping the implementation later shouldn't require page-level changes.
 * State resets whenever the dev server process restarts.
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

export type IssueLicenseInput = {
  product_id: string;
  tier: string;
  issued_to: string;
  expires_at: string;
  max_activations: number;
};

type Store = {
  licenses: License[];
  activations: Record<string, Activation[]>;
};

const globalForMockStore = globalThis as unknown as { __licenseMockStore?: Store };

function seedStore(): Store {
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
      },
    ],
    activations: {
      'CASZ-DEMO-ALPHA-0001': [
        { instance_id: 'inst_7f3a9c2e', activated_at: '2026-06-02T09:14:00Z' },
        { instance_id: 'inst_1b8d4f6a', activated_at: '2026-06-10T17:42:00Z' },
      ],
      'CASZ-DEMO-BETA-0002': [
        { instance_id: 'inst_9e2c5a1d', activated_at: '2026-05-16T11:03:00Z' },
      ],
    },
  };
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

export async function listLicenses(): Promise<License[]> {
  return [...getStore().licenses].sort((a, b) => (a.issued_at < b.issued_at ? 1 : -1));
}

export async function getLicense(key: string): Promise<License | null> {
  return getStore().licenses.find((license) => license.key === key) ?? null;
}

export async function issueLicense(input: IssueLicenseInput): Promise<License> {
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
  };
  getStore().licenses.push(license);
  return license;
}

export async function setLicenseRevoked(key: string, revoked: boolean): Promise<License | null> {
  const license = getStore().licenses.find((entry) => entry.key === key);
  if (!license) return null;
  license.status = revoked ? 'revoked' : 'active';
  license.revoked_at = revoked ? new Date().toISOString() : null;
  return license;
}

export async function deleteLicense(key: string): Promise<boolean> {
  const store = getStore();
  const index = store.licenses.findIndex((entry) => entry.key === key);
  if (index === -1) return false;
  store.licenses.splice(index, 1);
  delete store.activations[key];
  return true;
}

export async function listActivations(key: string): Promise<Activation[]> {
  return getStore().activations[key] ?? [];
}

export async function reissueActivationToken(
  key: string,
  instanceId: string
): Promise<{ token: string } | null> {
  const activations = getStore().activations[key];
  if (!activations?.some((activation) => activation.instance_id === instanceId)) {
    return null;
  }
  return { token: `reissued_${Math.random().toString(36).slice(2, 10)}` };
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const { licenses, activations } = getStore();
  return {
    active_licenses: licenses.filter((license) => license.status === 'active').length,
    active_activations: Object.values(activations).reduce((sum, list) => sum + list.length, 0),
    revoked_licenses: licenses.filter((license) => license.status === 'revoked').length,
  };
}

export async function getRecentActivations(limit = 5): Promise<RecentActivation[]> {
  const { activations } = getStore();
  const flattened: RecentActivation[] = Object.entries(activations).flatMap(([key, list]) =>
    list.map((activation) => ({ key, ...activation }))
  );
  return flattened
    .sort((a, b) => (a.activated_at < b.activated_at ? 1 : -1))
    .slice(0, limit);
}
