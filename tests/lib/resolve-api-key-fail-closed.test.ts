import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as live from '@/lib/license-client.live';

// SaaS-B2, finding F8: resolveApiKey() (lib/license-client.live.ts) has a
// hard-fail rule - under MULTI_TENANT, a missing tenantApiKey must THROW,
// never silently fall back to the global LICENSE_ADMIN_API_KEY. F8's own
// warning is what this suite exists to prevent: "a single missed call
// site silently operates as the superuser across all tenants, with
// correct-looking output" - a caller who forgets to thread a tenant's own
// key through would otherwise get real data back (the platform admin's),
// not an error, and nothing in the UI would look wrong.
//
// resolveApiKey() itself is not exported - by design, every one of the
// module's 25 exported functions is the only way anything outside this
// file can reach it, so this suite calls every one of them directly
// (the real call sites, not a mock of resolveApiKey) rather than unit
// testing the helper in isolation. A helper-only test would prove the
// rule works when called correctly; it would not prove that ever call
// site actually calls it, which is the entire risk F8 describes.
//
// Deliberately excludes getExpiringLicenses/getLicensesNearSeatLimit:
// both funnel through the internal, `cache()`-wrapped getBroadActiveLicenses,
// keyed only on the tenantApiKey argument - calling either twice with the
// same argument (e.g. `undefined`, used throughout the negative sweep
// below) across different MULTI_TENANT scenarios in this same module
// instance would silently return a memoized result from the *other*
// scenario instead of exercising resolveApiKey() again. Both still call
// liveFetch()/resolveApiKey() the same way as every function tested here
// (confirmed by reading the source directly, not assumed) - the risk this
// suite guards against is a missing/wrong call site, and both call sites
// were checked and correctly thread tenantApiKey through.
describe('resolveApiKey fail-closed under MULTI_TENANT (lib/license-client.live.ts, F8)', () => {
  beforeEach(() => {
    vi.stubEnv('LICENSE_API_URL', 'https://license.example.com/v1');
    vi.stubEnv('LICENSE_ADMIN_API_KEY', 'global-admin-key-must-never-be-used-here');
    vi.stubEnv('MULTI_TENANT', 'true');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  // Satisfies every function's response-shaping code (e.g. listLicenses'
  // and getRecentlyIssuedLicenses' own `.map()` over `licenses`) with one
  // generic body - this suite only cares whether the request was sent
  // with the right Authorization header, never what came back.
  const ok = () =>
    new Response(JSON.stringify({ licenses: [], activations: [] }), { status: 200 });

  // One call per exported function that reaches liveFetch(), with the
  // minimum arguments needed to exercise it. The actual response body is
  // irrelevant here (fetch is mocked) - only whether resolveApiKey() was
  // reached, and with what key, matters.
  const calls: Array<[name: string, invoke: (tenantApiKey?: string) => Promise<unknown>]> = [
    ['listLicenses', (k) => live.listLicenses({}, k)],
    ['getLicense', (k) => live.getLicense('LIC-1', k)],
    ['issueLicense', (k) =>
      live.issueLicense(
        { product_id: 'p', tier: 't', issued_to: 'x', expires_at: '2030-01-01', max_activations: 1 },
        k
      )],
    ['setLicenseRevoked', (k) => live.setLicenseRevoked('LIC-1', true, k)],
    ['updateLicenseTerms', (k) => live.updateLicenseTerms({ key: 'LIC-1' }, k)],
    ['updateLicenseNotes', (k) => live.updateLicenseNotes('LIC-1', 'note', k)],
    ['deleteLicense', (k) => live.deleteLicense('LIC-1', k)],
    ['listActivations', (k) => live.listActivations('LIC-1', k)],
    ['reissuePortalToken', (k) => live.reissuePortalToken('LIC-1', k)],
    ['reissueActivationToken', (k) => live.reissueActivationToken('LIC-1', 'inst-1', k)],
    ['deactivateByInstanceId', (k) => live.deactivateByInstanceId('LIC-1', 'inst-1', k)],
    ['deleteAccount', (k) => live.deleteAccount(k)],
    ['rotateApiKey', (k) => live.rotateApiKey(k)],
    ['getDashboardStats', (k) => live.getDashboardStats(k)],
    ['getRecentActivations', (k) => live.getRecentActivations(5, k)],
    ['getRecentlyIssuedLicenses', (k) => live.getRecentlyIssuedLicenses(5, k)],
    ['getBillingStatus', (k) => live.getBillingStatus(k)],
    ['createCheckoutSession', (k) => live.createCheckoutSession('pro', 'monthly', k)],
    ['completeStubCheckout', (k) => live.completeStubCheckout('pro', k)],
    ['getSelfLicenseStatus', (k) => live.getSelfLicenseStatus(k)],
    ['getTierAStatus', (k) => live.getTierAStatus(k)],
    ['listReleases', (k) => live.listReleases({}, k)],
    ['registerRelease', (k) =>
      live.registerRelease(
        { product_id: 'p', version: '1.0.0', platform: 'darwin-arm64', artifact_url: 'https://cdn.example.com/a', checksum: 'sha256:a' },
        k
      )],
    ['unpublishRelease', (k) => live.unpublishRelease(1, k)],
    ['getRelease', (k) => live.getRelease(1, k)],
  ];

  describe('missing tenantApiKey', () => {
    for (const [name, invoke] of calls) {
      it(`${name} refuses to fall back to the global admin key`, async () => {
        const fetchMock = vi.fn().mockResolvedValue(ok());
        vi.stubGlobal('fetch', fetchMock);

        await expect(invoke(undefined)).rejects.toThrow(
          /MULTI_TENANT is enabled but no tenantApiKey was provided/
        );

        // The real guarantee: never even attempts the request with the
        // global key. A caught-then-ignored throw that still fired the
        // request would defeat the whole point of a hard-fail rule.
        expect(fetchMock).not.toHaveBeenCalled();
      });
    }
  });

  describe('tenantApiKey provided', () => {
    for (const [name, invoke] of calls) {
      it(`${name} authenticates with the tenant's own key, not the global admin key`, async () => {
        const fetchMock = vi.fn().mockResolvedValue(ok());
        vi.stubGlobal('fetch', fetchMock);

        const tenantKey = `tenant-key-for-${name}`;
        await invoke(tenantKey);

        expect(fetchMock).toHaveBeenCalled();
        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        const headers = init.headers as Record<string, string>;
        expect(headers.Authorization).toBe(`Bearer ${tenantKey}`);
        expect(headers.Authorization).not.toContain('global-admin-key-must-never-be-used-here');
      });
    }
  });
});
