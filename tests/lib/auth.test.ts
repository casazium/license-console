import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normalizeEmail, verifyCredentials } from '@/lib/auth';

describe('normalizeEmail (lib/auth.ts)', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail(' Alice@Example.com ')).toBe('alice@example.com');
  });
});

describe('verifyCredentials - self-hosted mode (lib/auth.ts)', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env.MULTI_TENANT = 'false';
    process.env.ADMIN_UI_USERNAME = 'admin';
    process.env.ADMIN_UI_PASSWORD = 'super-secret-password';
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('accepts the configured username/password', async () => {
    const identity = await verifyCredentials('admin', 'super-secret-password');
    expect(identity).toEqual({ id: 'admin', role: 'admin', mode: 'selfhosted' });
  });

  it('rejects a wrong password', async () => {
    await expect(verifyCredentials('admin', 'nope')).resolves.toBeNull();
  });

  it('rejects a wrong username', async () => {
    await expect(verifyCredentials('someone-else', 'super-secret-password')).resolves.toBeNull();
  });

  it('throws when ADMIN_UI_USERNAME/PASSWORD are not configured', async () => {
    delete process.env.ADMIN_UI_USERNAME;
    delete process.env.ADMIN_UI_PASSWORD;
    await expect(verifyCredentials('admin', 'super-secret-password')).rejects.toThrow(
      /Missing required environment variable/
    );
  });
});
