import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPortalLink } from '@/lib/license-client';

// buildPortalLink() produces the link an operator hands to their own
// customer, so it has to point at an address that customer can actually
// open - not whatever private address this console happens to reach the
// license server through. casazium/license's self-hosted bundle is the
// real case: LICENSE_API_URL there is the compose network's internal
// http://license:3001/v1, and LICENSE_PUBLIC_URL carries the public one.
// vi.stubEnv to '' rather than delete, same reasoning as
// license-client-mode.test.ts's own header comment.
describe('buildPortalLink (lib/license-client.ts)', () => {
  beforeEach(() => {
    vi.stubEnv('LICENSE_API_URL', '');
    vi.stubEnv('LICENSE_PUBLIC_URL', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is null in standalone mode (no LICENSE_API_URL)', () => {
    expect(buildPortalLink('tok')).toBeNull();
  });

  it('is null in standalone mode even if LICENSE_PUBLIC_URL is set', () => {
    vi.stubEnv('LICENSE_PUBLIC_URL', 'https://license.example.com');
    expect(buildPortalLink('tok')).toBeNull();
  });

  it('derives the portal origin from LICENSE_API_URL, stripping /v1', () => {
    vi.stubEnv('LICENSE_API_URL', 'https://license.example.com/v1/');
    expect(buildPortalLink('tok')).toBe('https://license.example.com/portal/tok');
  });

  it('prefers LICENSE_PUBLIC_URL over an internal LICENSE_API_URL', () => {
    vi.stubEnv('LICENSE_API_URL', 'http://license:3001/v1');
    vi.stubEnv('LICENSE_PUBLIC_URL', 'https://license.example.com');
    expect(buildPortalLink('tok')).toBe('https://license.example.com/portal/tok');
  });

  it('accepts LICENSE_PUBLIC_URL with a /v1 suffix or trailing slash', () => {
    vi.stubEnv('LICENSE_API_URL', 'http://license:3001/v1');
    vi.stubEnv('LICENSE_PUBLIC_URL', 'https://license.example.com/v1/');
    expect(buildPortalLink('tok')).toBe('https://license.example.com/portal/tok');
  });

  it('URL-encodes the token', () => {
    vi.stubEnv('LICENSE_API_URL', 'https://license.example.com/v1');
    expect(buildPortalLink('a/b c')).toBe('https://license.example.com/portal/a%2Fb%20c');
  });
});
