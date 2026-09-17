import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getExpiringLicenses, getLicensesNearSeatLimit } from '@/lib/license-client.live';

// Console-side cross-tenant isolation. The backend (casazium/license) has
// its own extensive tenant-isolation test suite; this file covers a risk
// that lives entirely in this repo instead: getExpiringLicenses() and
// getLicensesNearSeatLimit() both read through an internal, `cache()`-
// wrapped getBroadActiveLicenses() helper (lib/license-client.live.ts),
// deliberately keyed on the tenantApiKey argument specifically "to avoid
// cross-tenant cache poisoning" per that code's own comment. A memoization
// keyed on the wrong thing (or not keyed at all) would let one tenant's
// admin see another tenant's licenses purely from an in-process cache hit
// - no backend bug required. This suite proves the key actually
// separates tenants, not just that the code comment claims it does.
//
// In its own file (a fresh module registry - Vitest isolates modules per
// test file by default) rather than alongside resolve-api-key-fail-closed
// .test.ts, specifically so this suite's real cache hits/misses across
// scenarios can't be confused with that file's argument choices.
describe('cross-tenant cache isolation (lib/license-client.live.ts)', () => {
  beforeEach(() => {
    vi.stubEnv('LICENSE_API_URL', 'https://license.example.com/v1');
    vi.stubEnv('LICENSE_ADMIN_API_KEY', 'unused-in-multi-tenant-calls');
    // Without MULTI_TENANT=true, resolveApiKey() ignores tenantApiKey
    // entirely and always uses the global admin key (the correct,
    // separate self-hosted behavior) - every call below would then share
    // one Authorization header regardless of which tenant key was passed,
    // defeating the very isolation this suite exists to prove.
    vi.stubEnv('MULTI_TENANT', 'true');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const nearFuture = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();

  function licenseFixture(overrides: Record<string, unknown>) {
    return {
      key: 'LIC-DEFAULT',
      product_id: 'default-product',
      tier: 'pro',
      status: 'active',
      issued_to: 'someone@example.com',
      issued_at: '2026-01-01T00:00:00.000Z',
      expires_at: nearFuture,
      max_activations: 5,
      activations_count: 4,
      notes: null,
      ...overrides,
    };
  }

  // Responds with different license data depending on the Authorization
  // header presented - stands in for two tenants' genuinely separate
  // backend data, keyed the same way the real multi-tenant backend keys
  // it (by the bearer token identifying the tenant).
  function fetchRespondingByTenant(dataByAuthHeader: Record<string, unknown[]>) {
    return vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const auth = (init.headers as Record<string, string>).Authorization;
      const licenses = dataByAuthHeader[auth] ?? [];
      return Promise.resolve(new Response(JSON.stringify({ licenses }), { status: 200 }));
    });
  }

  it('getExpiringLicenses never returns another tenant\'s license from a cached broad fetch', async () => {
    const fetchMock = fetchRespondingByTenant({
      'Bearer tenant-a-key': [licenseFixture({ key: 'LIC-A', product_id: 'tenant-a-product' })],
      'Bearer tenant-b-key': [licenseFixture({ key: 'LIC-B', product_id: 'tenant-b-product' })],
    });
    vi.stubGlobal('fetch', fetchMock);

    const aFirst = await getExpiringLicenses(30, 5, 'tenant-a-key');
    expect(aFirst.map((l) => l.key)).toEqual(['LIC-A']);

    const bFirst = await getExpiringLicenses(30, 5, 'tenant-b-key');
    expect(bFirst.map((l) => l.key)).toEqual(['LIC-B']);
    // The real assertion: tenant B's call must have gone back to the
    // network under its own key, not returned tenant A's memoized result.
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);

    // Re-querying tenant A afterward (a cache hit is fine and expected -
    // that's the feature) must still yield only tenant A's data, proving
    // tenant B's intervening call didn't overwrite or bleed into it.
    const aSecond = await getExpiringLicenses(30, 5, 'tenant-a-key');
    expect(aSecond.map((l) => l.key)).toEqual(['LIC-A']);
  });

  it('getLicensesNearSeatLimit never returns another tenant\'s license from the same shared cache', async () => {
    const fetchMock = fetchRespondingByTenant({
      'Bearer tenant-a-key': [
        licenseFixture({ key: 'LIC-A', product_id: 'tenant-a-product', max_activations: 5, activations_count: 5 }),
      ],
      'Bearer tenant-b-key': [
        licenseFixture({ key: 'LIC-B', product_id: 'tenant-b-product', max_activations: 10, activations_count: 10 }),
      ],
    });
    vi.stubGlobal('fetch', fetchMock);

    const a = await getLicensesNearSeatLimit(5, 'tenant-a-key');
    expect(a.map((l) => l.key)).toEqual(['LIC-A']);

    const b = await getLicensesNearSeatLimit(5, 'tenant-b-key');
    expect(b.map((l) => l.key)).toEqual(['LIC-B']);
  });

  it('getExpiringLicenses and getLicensesNearSeatLimit share the underlying cache correctly per tenant, not per call site', async () => {
    // Both functions read through the same internal getBroadActiveLicenses()
    // helper - confirms a tenant's data fetched via one route is
    // consistent when read via the other, and still never crosses into a
    // different tenant's key.
    const fetchMock = fetchRespondingByTenant({
      'Bearer tenant-a-key': [
        licenseFixture({ key: 'LIC-A', product_id: 'tenant-a-product', max_activations: 5, activations_count: 5 }),
      ],
    });
    vi.stubGlobal('fetch', fetchMock);

    const expiring = await getExpiringLicenses(30, 5, 'tenant-a-key');
    const nearLimit = await getLicensesNearSeatLimit(5, 'tenant-a-key');

    expect(expiring.map((l) => l.key)).toEqual(['LIC-A']);
    expect(nearLimit.map((l) => l.key)).toEqual(['LIC-A']);
  });
});
