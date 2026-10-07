// setStorefrontSubscriptionGraceAction (app/(app)/settings/actions.ts):
// the console's last check before License Server 1.9.0's PATCH - a whole
// number of days, 0-30, refused before any request is made.
import { afterEach, describe, expect, it, vi } from 'vitest';

const setGraceOnServer = vi.fn();

vi.mock('@/lib/tenant-context', () => ({
  requireSessionWithTenantKey: vi.fn().mockResolvedValue({ identity: { tenantId: 't1' }, tenantApiKey: 'tenant-key' }),
  markIfTenantRejected: vi.fn(),
}));
vi.mock('@/lib/license-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/license-client')>()),
  setStorefrontSubscriptionGrace: (...args: unknown[]) => setGraceOnServer(...args),
}));

const { setStorefrontSubscriptionGraceAction } = await import('@/app/(app)/settings/actions');

describe('setStorefrontSubscriptionGraceAction', () => {
  afterEach(() => setGraceOnServer.mockReset());

  it.each([31, -1, 7.5, Number.NaN, Number.POSITIVE_INFINITY])('refuses %s before any request', async (value) => {
    await expect(setStorefrontSubscriptionGraceAction('wh_1', value)).resolves.toEqual({
      ok: false,
      reason: 'validation',
      message: 'Enter a whole number of days from 0 to 30',
    });
    expect(setGraceOnServer).not.toHaveBeenCalled();
  });

  it.each([0, 7, 30])('sends %i with the tenant key', async (value) => {
    setGraceOnServer.mockResolvedValueOnce(true);
    await expect(setStorefrontSubscriptionGraceAction('wh_1', value)).resolves.toEqual({ ok: true, data: true });
    expect(setGraceOnServer).toHaveBeenCalledWith('wh_1', value, 'tenant-key');
  });

  it("passes a server refusal's message back", async () => {
    setGraceOnServer.mockRejectedValueOnce(new Error('This webhook is disabled - connect a new one'));
    await expect(setStorefrontSubscriptionGraceAction('wh_1', 7)).resolves.toEqual({
      ok: false,
      reason: 'validation',
      message: 'This webhook is disabled - connect a new one',
    });
  });
});
