// deleteAccountAction (app/(app)/settings/actions.ts): License Server
// 1.10.0+ cancels the paid subscription before deleting a hosted account,
// and if it can't, keeps the account and answers 502. The action reports
// that distinctly, so the user hears nothing was deleted rather than a
// generic failure - and it deletes nothing locally either.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LicenseApiError } from '@/lib/errors';

const deleteOnServer = vi.fn();
const prepare = vi.fn();

vi.mock('@/lib/tenant-context', () => ({
  requireSessionWithTenantKey: vi
    .fn()
    .mockResolvedValue({ identity: { id: 'acct_1', tenantId: 't1' }, tenantApiKey: 'tenant-key' }),
  markIfTenantRejected: vi.fn(),
}));
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  verifyAccountPassword: vi.fn().mockResolvedValue(true),
}));
vi.mock('@/lib/db', () => ({ getDb: () => ({ prepare, transaction: (fn: () => void) => fn }) }));
vi.mock('@/lib/license-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/license-client')>()),
  deleteAccount: (...args: unknown[]) => deleteOnServer(...args),
}));

const { deleteAccountAction } = await import('@/app/(app)/settings/actions');

describe('deleteAccountAction', () => {
  afterEach(() => {
    deleteOnServer.mockReset();
    prepare.mockReset();
  });

  it("reports a subscription the server couldn't cancel (502), and deletes nothing locally", async () => {
    deleteOnServer.mockRejectedValueOnce(new LicenseApiError('Failed to delete account: 502 Bad Gateway', 502));
    await expect(deleteAccountAction('correct-password')).resolves.toEqual({ reason: 'subscription-not-canceled' });
    expect(deleteOnServer).toHaveBeenCalledWith('tenant-key');
    expect(prepare).not.toHaveBeenCalled();
  });

  it('still throws other server failures', async () => {
    deleteOnServer.mockRejectedValueOnce(new LicenseApiError('Failed to delete account: 500 Internal Server Error', 500));
    await expect(deleteAccountAction('correct-password')).rejects.toThrow(/500/);
    expect(prepare).not.toHaveBeenCalled();
  });
});
