import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ListLicensesParams, ListLicensesResult, LicenseListItem } from '@/lib/license-types';

// GET /api/export-data used to make a single GET /list-licenses call
// capped at 1000 total - fine while Pro (1,000 active licenses) was the
// highest tier, since no real tenant could exceed it. Adding the
// Business tier (10,000 active licenses) exposed that assumption: a
// Business tenant above 1,000 active licenses got a silently truncated
// "full" export (a normal 200 response, a valid-looking download, the
// shortfall visible only in a server-side console.warn). This suite
// proves fetchAllLicenses actually loops over pages instead of trusting
// one capped call, and that its own MAX_EXPORT_LICENSES ceiling is a
// real, reachable stopping point rather than a "this never happens"
// comment.

const mockListLicenses = vi.fn<
  (params: ListLicensesParams, tenantApiKey?: string) => Promise<ListLicensesResult>
>();

vi.mock('@/lib/license-client', () => ({
  listLicenses: (params: ListLicensesParams, tenantApiKey?: string) => mockListLicenses(params, tenantApiKey),
}));

function fakeLicenses(count: number, startAt = 0): LicenseListItem[] {
  return Array.from({ length: count }, (_, i) => ({ key: `key-${startAt + i}` }) as unknown as LicenseListItem);
}

describe('fetchAllLicenses (lib/export-licenses.ts)', () => {
  beforeEach(() => {
    mockListLicenses.mockReset();
  });

  it('a tenant under one page fetches in a single call', async () => {
    mockListLicenses.mockResolvedValueOnce({ licenses: fakeLicenses(5), total: 5 });

    const { fetchAllLicenses } = await import('@/lib/export-licenses');
    const result = await fetchAllLicenses('tenant-key');

    expect(mockListLicenses).toHaveBeenCalledTimes(1);
    expect(mockListLicenses).toHaveBeenCalledWith({ limit: 1000, offset: 0 }, 'tenant-key');
    expect(result.licenses).toHaveLength(5);
    expect(result.total).toBe(5);
  });

  it('a tenant spanning multiple pages loops until every license is fetched - the actual Business-tier scenario', async () => {
    // 2,500 active licenses: below Business's 10,000 ceiling but well
    // past the old MAX_LICENSES=1000 single-call cap - the exact shape
    // of tenant the old code silently truncated.
    mockListLicenses
      .mockResolvedValueOnce({ licenses: fakeLicenses(1000, 0), total: 2500 })
      .mockResolvedValueOnce({ licenses: fakeLicenses(1000, 1000), total: 2500 })
      .mockResolvedValueOnce({ licenses: fakeLicenses(500, 2000), total: 2500 });

    const { fetchAllLicenses } = await import('@/lib/export-licenses');
    const result = await fetchAllLicenses('tenant-key');

    expect(mockListLicenses).toHaveBeenCalledTimes(3);
    expect(mockListLicenses).toHaveBeenNthCalledWith(1, { limit: 1000, offset: 0 }, 'tenant-key');
    expect(mockListLicenses).toHaveBeenNthCalledWith(2, { limit: 1000, offset: 1000 }, 'tenant-key');
    expect(mockListLicenses).toHaveBeenNthCalledWith(3, { limit: 1000, offset: 2000 }, 'tenant-key');
    expect(result.licenses).toHaveLength(2500);
    expect(result.total).toBe(2500);
    // No duplicated/skipped rows across the page boundary.
    expect(result.licenses[999].key).toBe('key-999');
    expect(result.licenses[1000].key).toBe('key-1000');
    expect(result.licenses[2499].key).toBe('key-2499');
  });

  it('a tenant at exactly the Business-tier ceiling (10,000 licenses) fetches all of them, not just the old 1,000-row cap', async () => {
    mockListLicenses.mockImplementation(async ({ offset }) => {
      const remaining = 10000 - (offset ?? 0);
      const pageSize = Math.min(1000, remaining);
      return { licenses: fakeLicenses(pageSize, offset ?? 0), total: 10000 };
    });

    const { fetchAllLicenses } = await import('@/lib/export-licenses');
    const result = await fetchAllLicenses('tenant-key');

    expect(mockListLicenses).toHaveBeenCalledTimes(10);
    expect(result.licenses).toHaveLength(10000);
    expect(result.total).toBe(10000);
  });

  it('stops at MAX_EXPORT_LICENSES rather than looping forever for a tenant whose total rows exceed even that ceiling', async () => {
    const { MAX_EXPORT_LICENSES } = await import('@/lib/export-licenses');
    const wellPastCeiling = MAX_EXPORT_LICENSES + 5000;

    mockListLicenses.mockImplementation(async ({ offset }) => ({
      licenses: fakeLicenses(1000, offset ?? 0),
      total: wellPastCeiling,
    }));

    const { fetchAllLicenses } = await import('@/lib/export-licenses');
    const result = await fetchAllLicenses('tenant-key');

    expect(result.licenses).toHaveLength(MAX_EXPORT_LICENSES);
    // total is still reported as the real (larger) count, so the caller
    // (GET /api/export-data) can detect and log the real truncation via
    // `total > licenses.length` - it must not get silently clamped here.
    expect(result.total).toBe(wellPastCeiling);
  });

  it("doesn't loop forever if a page unexpectedly comes back empty before reaching the reported total", async () => {
    mockListLicenses.mockResolvedValueOnce({ licenses: fakeLicenses(500), total: 2000 }).mockResolvedValueOnce({
      licenses: [],
      total: 2000,
    });

    const { fetchAllLicenses } = await import('@/lib/export-licenses');
    const result = await fetchAllLicenses('tenant-key');

    expect(mockListLicenses).toHaveBeenCalledTimes(2);
    expect(result.licenses).toHaveLength(500);
    expect(result.total).toBe(2000); // Caller sees total > licenses.length and logs the shortfall.
  });
});
