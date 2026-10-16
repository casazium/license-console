import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Activation, LicenseListItem, ListLicensesParams, ListLicensesResult } from '@/lib/license-types';
import { LicenseApiError } from '@/lib/errors';

// GET /api/export-data used to call GET /list-activations/:key once per
// license. Every one of those counts against the License Server's admin
// rate limit (ADMIN_RATE_LIMIT_MAX, 300 per 15 minutes per tenant by
// default), so any account past ~297 licenses got "Too many requests" on
// every export. The export now asks list-licenses for activations inline
// (casazium/license 1.12.0+) and only falls back to the per-license calls
// against a server that ignores that flag.

const mockListLicenses = vi.fn<(params: ListLicensesParams, tenantApiKey?: string) => Promise<ListLicensesResult>>();
const mockListActivations = vi.fn<(key: string, tenantApiKey?: string) => Promise<Activation[]>>();
const mockGetBillingStatus = vi.fn(async () => ({ plan: 'business' }));

vi.mock('@/lib/license-client', () => ({
  listLicenses: (params: ListLicensesParams, tenantApiKey?: string) => mockListLicenses(params, tenantApiKey),
  listActivations: (key: string, tenantApiKey?: string) => mockListActivations(key, tenantApiKey),
  getBillingStatus: () => mockGetBillingStatus(),
}));
vi.mock('@/lib/session', () => ({
  requireSession: async () => ({ id: 'account-1', tenantId: 'tenant-1' }),
}));
vi.mock('@/lib/tenant-context', () => ({
  getTenantApiKey: () => 'tenant-key',
  getTenantName: () => 'Tenant One',
  markIfTenantRejected: () => {},
}));
vi.mock('@/lib/auth', () => ({ getAccountEmail: () => 'owner@example.com' }));
vi.mock('@/lib/export-rate-limit', () => ({ checkExportCooldown: () => null }));
vi.mock('@/lib/config', () => ({ publicBaseUrl: () => 'https://console.example.com' }));

function license(i: number, activations?: Activation[]): LicenseListItem {
  return {
    key: `key-${i}`,
    product_id: 'app',
    tier: 'pro',
    status: 'active',
    issued_to: `user${i}@example.com`,
    issued_at: '2026-01-01 00:00:00',
    expires_at: null,
    limits: {},
    usage: {},
    max_activations: null,
    revoked_at: null,
    activations_used: activations?.length ?? 0,
    ...(activations ? { activations } : {}),
  } as unknown as LicenseListItem;
}

function pagedServer(count: number, withActivations: boolean) {
  mockListLicenses.mockImplementation(async ({ offset = 0, limit = 1000, include_activations }) => {
    const size = Math.max(0, Math.min(limit, count - offset));
    const licenses = Array.from({ length: size }, (_, i) =>
      license(offset + i, withActivations && include_activations ? [{ instance_id: `m-${offset + i}`, activated_at: '2026-02-01 00:00:00' }] : undefined)
    );
    return { licenses, total: count };
  });
}

async function runExport() {
  const { GET } = await import('@/app/api/export-data/route');
  return GET(new NextRequest('https://console.example.com/api/export-data'));
}

describe('GET /api/export-data', () => {
  beforeEach(() => {
    mockListLicenses.mockReset();
    mockListActivations.mockReset();
    mockGetBillingStatus.mockClear();
  });

  it('exports 2,500 licenses in three list calls and one billing call - no per-license activation calls', async () => {
    pagedServer(2500, true);

    const res = await runExport();

    expect(res.status).toBe(200);
    expect(mockListLicenses).toHaveBeenCalledTimes(3);
    expect(mockListLicenses.mock.calls.every(([params]) => params.include_activations === true)).toBe(true);
    expect(mockListActivations).not.toHaveBeenCalled();
    expect(mockGetBillingStatus).toHaveBeenCalledTimes(1);

    const body = JSON.parse(await res.text());
    expect(body.licenses).toHaveLength(2500);
    expect(body.licenses[1234].activations).toEqual([{ instance_id: 'm-1234', activated_at: '2026-02-01 00:00:00' }]);
    // The export's own shape: activations_used is a list-view field, not exported.
    expect(body.licenses[0]).not.toHaveProperty('activations_used');
  });

  it('keeps a license with no activations as [] without a fallback call', async () => {
    mockListLicenses.mockResolvedValueOnce({ licenses: [license(0, [])], total: 1 });

    const res = await runExport();

    expect(res.status).toBe(200);
    expect(mockListActivations).not.toHaveBeenCalled();
    expect(JSON.parse(await res.text()).licenses[0].activations).toEqual([]);
  });

  it('falls back to one list-activations call per license against a server that ignores include_activations', async () => {
    pagedServer(25, false);
    mockListActivations.mockImplementation(async (key) => [{ instance_id: `fallback-${key}`, activated_at: '2026-02-01 00:00:00' }]);

    const res = await runExport();

    expect(res.status).toBe(200);
    expect(mockListActivations).toHaveBeenCalledTimes(25);
    const body = JSON.parse(await res.text());
    expect(body.licenses[3].activations[0].instance_id).toBe('fallback-key-3');
  });

  it('still redirects to Settings with rate-limited when the server answers 429', async () => {
    mockListLicenses.mockRejectedValueOnce(new LicenseApiError('Too many requests', 429));

    const res = await runExport();

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://console.example.com/settings?exportError=rate-limited');
  });
});
