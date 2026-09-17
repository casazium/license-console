import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkExportCooldown } from '@/lib/export-rate-limit';

// GET /api/export-data's per-account cooldown (see the module's own
// header comment: a security review found a tenant could repeatedly
// trigger an up-to-1000-row activation fan-out and exhaust the
// backend's shared per-tenant admin rate limit "in three clicks").
// login-rate-limit.ts's near-identical shape already has thorough tests
// (allow-then-block, refund, key hashing); this module had none at all
// - specifically missing the one property that actually matters here:
// the cooldown is per-*account*, not a single global gate that would
// let one tenant's export activity block every other tenant's.
describe('checkExportCooldown (lib/export-rate-limit.ts)', () => {
  let counter = 0;
  function uniqueAccountId(label: string): string {
    counter += 1;
    return `${label}-${counter}`;
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows the first export for a fresh account', () => {
    const accountId = uniqueAccountId('first');
    expect(checkExportCooldown(accountId)).toBeNull();
  });

  it('blocks an immediate second export from the same account, returning seconds remaining', () => {
    const accountId = uniqueAccountId('immediate-repeat');
    expect(checkExportCooldown(accountId)).toBeNull();

    const result = checkExportCooldown(accountId);
    expect(result).not.toBeNull();
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(60);
  });

  it('never blocks a different account because another account is in cooldown (per-account, not global)', () => {
    const accountA = uniqueAccountId('tenant-a');
    const accountB = uniqueAccountId('tenant-b');

    expect(checkExportCooldown(accountA)).toBeNull();
    // Account A is now in cooldown - account B, exporting immediately
    // after, must be completely unaffected by it.
    expect(checkExportCooldown(accountB)).toBeNull();
  });

  it('allows another export once the cooldown window has fully elapsed', () => {
    const accountId = uniqueAccountId('elapses');
    expect(checkExportCooldown(accountId)).toBeNull();
    expect(checkExportCooldown(accountId)).not.toBeNull();

    vi.advanceTimersByTime(60 * 1000);

    expect(checkExportCooldown(accountId)).toBeNull();
  });

  it('still blocks one millisecond before the cooldown window elapses', () => {
    const accountId = uniqueAccountId('just-before-elapsed');
    expect(checkExportCooldown(accountId)).toBeNull();

    vi.advanceTimersByTime(60 * 1000 - 1);

    const result = checkExportCooldown(accountId);
    expect(result).not.toBeNull();
    expect(result).toBe(1);
  });
});
