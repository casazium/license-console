import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as live from '@/lib/license-client.live';
import * as mock from '@/lib/license-client.mock';

// The data export asks GET /list-licenses for activations inline
// (include_activations, casazium/license 1.12.0+) instead of one
// GET /list-activations/:key per license, which ran any account past
// ~297 licenses into the admin rate limit. tests/routes/export-data.test.ts
// covers the route with the client mocked; this covers the clients
// themselves: the live one must send the flag and keep the field, and
// only when asked, and the mock must match.

const row = {
  key: 'key-1',
  tier: 'pro',
  product_id: 'app',
  issued_to: 'user@example.com',
  issued_at: '2026-01-01 00:00:00',
  expires_at: null,
  status: 'active',
  limits: {},
  usage: {},
  max_activations: null,
  revoked_at: null,
  activations_count: 1,
};

describe('listLicenses include_activations (lib/license-client.live.ts)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv('LICENSE_API_URL', 'https://license.example.com/v1');
    vi.stubEnv('LICENSE_ADMIN_API_KEY', 'test-admin-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function respondWith(licenses: unknown[]) {
    fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ licenses, total: licenses.length }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  }

  function requestedQuery(): URLSearchParams {
    return new URL(fetchMock.mock.calls[0][0] as string).searchParams;
  }

  it('sends include_activations=true and passes each row\'s activations through', async () => {
    const activations = [{ instance_id: 'machine-1', activated_at: '2026-02-01 00:00:00' }];
    respondWith([{ ...row, activations }]);

    const result = await live.listLicenses({ limit: 1000, offset: 0, include_activations: true }, 'tenant-key');

    expect(requestedQuery().get('include_activations')).toBe('true');
    expect(result.licenses[0].activations).toEqual(activations);
    expect(result.licenses[0].activations_used).toBe(1);
  });

  it('leaves the flag off by default, as the table and dashboard callers expect', async () => {
    respondWith([row]);

    const result = await live.listLicenses({ limit: 50, offset: 0 }, 'tenant-key');

    expect(requestedQuery().has('include_activations')).toBe(false);
    expect(result.licenses[0].activations).toBeUndefined();
  });

  it('leaves activations undefined when an older server ignores the flag - the export\'s fallback signal', async () => {
    respondWith([row]);

    const result = await live.listLicenses({ limit: 1000, offset: 0, include_activations: true }, 'tenant-key');

    expect(requestedQuery().get('include_activations')).toBe('true');
    expect(result.licenses[0]).not.toHaveProperty('activations');
  });
});

describe('listLicenses include_activations (lib/license-client.mock.ts)', () => {
  it('attaches the same activations listActivations returns, [] for a license with none', async () => {
    const { licenses } = await mock.listLicenses({ limit: 1000, offset: 0, include_activations: true });

    expect(licenses.length).toBeGreaterThan(0);
    expect(licenses.every((license) => Array.isArray(license.activations))).toBe(true);
    for (const license of licenses) {
      expect(license.activations).toEqual(await mock.listActivations(license.key));
      expect(license.activations).toHaveLength(license.activations_used);
    }
    expect(licenses.some((license) => license.activations!.length === 0)).toBe(true);
    expect(licenses.some((license) => license.activations!.length > 0)).toBe(true);
  });

  it('leaves activations off by default', async () => {
    const { licenses } = await mock.listLicenses({ limit: 1000, offset: 0 });

    expect(licenses.every((license) => !('activations' in license))).toBe(true);
  });
});
