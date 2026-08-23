import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerRelease } from '@/lib/license-client.live';
import {
  LicenseApiError,
  isDuplicateRelease,
  isInvalidArtifactUrl,
  isReleaseNotesTooLong,
  isReleaseLimitReached,
} from '@/lib/errors';

// Round-4 independent review, finding F4: throwForFailedResponse()
// (license-client.live.ts) only preserved the license server's own error
// text for a 403 response. lib/errors.ts's isReservedProductId()
// classifier (round-3, matching register-release.js's 400 rejection for
// the reserved `_casazium_` prefix) was wired into registerReleaseAction
// since round 3 but could never actually match - every 400 fell into the
// generic "Failed to X: 400 Bad Request" fallback, so the bespoke
// "This product ID is reserved" UI copy was unreachable. Confirms the
// fix by asserting the real server body text survives onto the thrown
// error for a 400, the same way it already did for a 403.
describe('registerRelease preserves the server error body (lib/license-client.live.ts, F4)', () => {
  beforeEach(() => {
    vi.stubEnv('LICENSE_API_URL', 'https://license.example.com/v1');
    vi.stubEnv('LICENSE_ADMIN_API_KEY', 'test-admin-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const input = {
    product_id: '_casazium_self_license_tier_b',
    version: '1.0.0',
    platform: 'darwin-arm64',
    artifact_url: 'https://cdn.example.com/app.dmg',
    checksum: 'sha256:abc',
  };

  it('surfaces the real body text on a 400 (previously fell through to a generic fallback)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'product_id uses a reserved prefix' }), {
          status: 400,
          statusText: 'Bad Request',
        })
      )
    );

    await expect(registerRelease(input)).rejects.toMatchObject({
      message: 'product_id uses a reserved prefix',
      status: 400,
    });
    await expect(registerRelease(input)).rejects.toBeInstanceOf(LicenseApiError);
  });

  it('still surfaces the real body text on a 403, unaffected by the 400 fix', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'product_id is owned by a different tenant' }), {
          status: 403,
          statusText: 'Forbidden',
        })
      )
    );

    await expect(registerRelease(input)).rejects.toMatchObject({
      message: 'product_id is owned by a different tenant',
      status: 403,
    });
  });

  it('falls back to the generic message for a status this function does not special-case', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 500, statusText: 'Internal Server Error' }))
    );

    await expect(registerRelease(input)).rejects.toMatchObject({
      message: 'Failed to register release: 500 Internal Server Error',
      status: 500,
    });
  });

  // Round-5 independent review, finding F5-6: throwForFailedResponse
  // didn't preserve 409 bodies at all until this round (register-release's
  // duplicate-registration rejection, added in round 4, had never once
  // been reachable by lib/errors.ts's own isDuplicateRelease()).
  it('surfaces the real body text on a 409 (previously never preserved at all)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'A release already exists for this product_id/version/channel/platform' }), {
          status: 409,
          statusText: 'Conflict',
        })
      )
    );

    await expect(registerRelease(input)).rejects.toMatchObject({
      message: 'A release already exists for this product_id/version/channel/platform',
      status: 409,
    });
  });
});

// Round-5 independent review, finding F5-6: these four classifiers
// didn't exist prior to this round, so a rejected artifact_url, an
// over-long release_notes, a duplicate registration, and a bucket at
// its release cap all fell through registerReleaseAction's catch chain
// to the generic "Something went wrong" case.
describe('lib/errors.ts classifiers added for F5-6', () => {
  it('isInvalidArtifactUrl matches only the exact artifact_url rejection', () => {
    expect(isInvalidArtifactUrl(new LicenseApiError('artifact_url must be a valid http(s) URL', 400))).toBe(true);
    expect(isInvalidArtifactUrl(new LicenseApiError('artifact_url must be a valid http(s) URL', 403))).toBe(false);
    expect(isInvalidArtifactUrl(new LicenseApiError('something else', 400))).toBe(false);
  });

  it('isReleaseNotesTooLong matches Fastify\'s schema-validation text', () => {
    expect(
      isReleaseNotesTooLong(new LicenseApiError('Release_notes must NOT have more than 10000 characters', 400))
    ).toBe(true);
    expect(isReleaseNotesTooLong(new LicenseApiError('something else', 400))).toBe(false);
  });

  it('isDuplicateRelease matches only 409 with the exact duplicate message', () => {
    expect(
      isDuplicateRelease(
        new LicenseApiError('A release already exists for this product_id/version/channel/platform', 409)
      )
    ).toBe(true);
    expect(
      isDuplicateRelease(
        new LicenseApiError('A release already exists for this product_id/version/channel/platform', 400)
      )
    ).toBe(false);
  });

  it('isReleaseLimitReached matches on the 403 prefix (message includes the current cap)', () => {
    expect(
      isReleaseLimitReached(
        new LicenseApiError(
          'Release limit reached (500 published releases) for this product_id/channel/platform - unpublish old releases before registering new ones',
          403
        )
      )
    ).toBe(true);
    expect(isReleaseLimitReached(new LicenseApiError('product_id is owned by a different tenant', 403))).toBe(false);
  });
});
