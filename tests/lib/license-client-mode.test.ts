import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getBackendMode } from '@/lib/license-client';

// getBackendMode() is the switch that decides whether the whole console
// talks to a real license server or serves canned mock data - a
// misconfiguration here means either a broken deploy (throws, loudly) or,
// worse, an operator silently looking at fixtures instead of real license
// data (see the function's own comment on why bare unset-in-production
// isn't allowed to silently mean mock).
//
// vi.stubEnv (not direct process.env assignment) - NODE_ENV is typed
// readonly by Next's own ambient types, and vi.unstubAllEnvs() restores
// everything this suite touches automatically.
describe('getBackendMode (lib/license-client.ts)', () => {
  beforeEach(() => {
    delete process.env.LICENSE_API_URL;
    delete process.env.LICENSE_ADMIN_API_KEY;
    delete process.env.LICENSE_STANDALONE_MODE;
    vi.stubEnv('NODE_ENV', 'test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is "mock" when neither var is set (non-production)', () => {
    expect(getBackendMode()).toBe('mock');
  });

  it('is "live" when both vars are set', () => {
    vi.stubEnv('LICENSE_API_URL', 'https://license.example.com');
    vi.stubEnv('LICENSE_ADMIN_API_KEY', 'key_abc');
    expect(getBackendMode()).toBe('live');
  });

  it('throws when only LICENSE_API_URL is set', () => {
    vi.stubEnv('LICENSE_API_URL', 'https://license.example.com');
    expect(() => getBackendMode()).toThrow(/must both be set/);
  });

  it('throws when only LICENSE_ADMIN_API_KEY is set', () => {
    vi.stubEnv('LICENSE_ADMIN_API_KEY', 'key_abc');
    expect(() => getBackendMode()).toThrow(/must both be set/);
  });

  it('throws in production when both are unset and LICENSE_STANDALONE_MODE is not "true"', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => getBackendMode()).toThrow(/production build/);
  });

  it('is "mock" in production when both are unset but LICENSE_STANDALONE_MODE="true"', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('LICENSE_STANDALONE_MODE', 'true');
    expect(getBackendMode()).toBe('mock');
  });
});
