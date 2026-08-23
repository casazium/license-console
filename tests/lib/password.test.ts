import { describe, expect, it } from 'vitest';
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from '@/lib/password';

describe('password hashing (lib/password.ts)', () => {
  it('round-trips a correct password', async () => {
    const stored = await hashPassword('correct horse battery staple');
    await expect(verifyPassword('correct horse battery staple', stored)).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const stored = await hashPassword('correct horse battery staple');
    await expect(verifyPassword('wrong password', stored)).resolves.toBe(false);
  });

  it('encodes N/r/p cost parameters into the stored hash', async () => {
    const stored = await hashPassword('anything');
    const parts = stored.split('$');
    expect(parts[0]).toBe('scrypt');
    expect(parts).toHaveLength(6);
  });

  it('rejects a malformed/legacy-format stored hash instead of throwing', async () => {
    await expect(verifyPassword('anything', 'salt:hashHex')).resolves.toBe(false);
    await expect(verifyPassword('anything', '')).resolves.toBe(false);
  });

  it('DUMMY_PASSWORD_HASH parses and never verifies as a match', async () => {
    await expect(verifyPassword('literally anything', DUMMY_PASSWORD_HASH)).resolves.toBe(false);
  });

  it('two hashes of the same password use different salts', async () => {
    const a = await hashPassword('same password');
    const b = await hashPassword('same password');
    expect(a).not.toBe(b);
  });
});
