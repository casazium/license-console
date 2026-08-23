'use server';

import { revalidatePath } from 'next/cache';
import {
  registerRelease,
  unpublishRelease,
  type RegisterReleaseInput,
  type RegisterReleaseResult,
} from '@/lib/license-client';
import {
  isRateLimited,
  isProductIdTaken,
  isPaymentFailed,
  isReservedProductId,
  isInvalidArtifactUrl,
  isReleaseNotesTooLong,
  isProductIdTooLong,
  isVersionTooLong,
  isChannelTooLong,
  isPlatformTooLong,
  isChecksumTooLong,
  isArtifactUrlTooLong,
  isDuplicateRelease,
  isReleaseLimitReached,
} from '@/lib/errors';
import { requireSessionWithTenantKey, markIfTenantRejected } from '@/lib/tenant-context';

// Same ActionResult<T> shape as app/(app)/licenses/actions.ts, for the
// same reason - a Server Action's thrown-error details are redacted once
// they cross the client boundary, so a rate-limited or product_id-taken
// request has to be caught here and returned as a plain value instead.
//
// 'payment-failed'/'reserved-product-id' added (round-3 independent
// review, finding C-1): registerReleaseAction previously only checked
// isRateLimited/isProductIdTaken, so a tenant blocked by
// register-release.js's own billing-standing check or reserved-prefix
// guard (both added in the round-2 fix-up, after this action was first
// written) fell all the way through to the generic
// "Failed to register release" catch-all, with nothing telling them
// their own input or account standing - not a transient failure - was
// the actual problem.
//
// 'invalid-artifact-url'/'release-notes-too-long'/'duplicate-release'/
// 'release-limit-reached' added (round-5 independent review, finding
// F5-6): the same gap as above, for four more backend rejections that
// had accumulated across rounds 3-5 (artifact_url scheme, release_notes
// length, the round-4 duplicate-registration 409, and round-5's own
// per-bucket release cap) without ever getting a matching branch here -
// all four fell through to the generic catch-all too.
//
// '{field}-too-long' (product-id/version/channel/platform/artifact-url/
// checksum) added (round-6 focused review, findings R6-3/R6-4): round
// 5's own F5-4 bounded six more fields, but only release_notes ever got
// a matching classifier - the other six fell through the same way.
type ActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      reason:
        | 'rate-limited'
        | 'product-id-taken'
        | 'payment-failed'
        | 'reserved-product-id'
        | 'invalid-artifact-url'
        | 'release-notes-too-long'
        | 'product-id-too-long'
        | 'version-too-long'
        | 'channel-too-long'
        | 'platform-too-long'
        | 'checksum-too-long'
        | 'artifact-url-too-long'
        | 'duplicate-release'
        | 'release-limit-reached';
    };

export async function registerReleaseAction(
  input: RegisterReleaseInput,
): Promise<ActionResult<RegisterReleaseResult>> {
  const { identity, tenantApiKey } = await requireSessionWithTenantKey();
  try {
    const release = await registerRelease(input, tenantApiKey);
    revalidatePath('/releases');
    return { ok: true, data: release };
  } catch (err) {
    if (isRateLimited(err)) return { ok: false, reason: 'rate-limited' };
    if (isProductIdTaken(err)) return { ok: false, reason: 'product-id-taken' };
    if (isPaymentFailed(err)) return { ok: false, reason: 'payment-failed' };
    if (isReservedProductId(err)) return { ok: false, reason: 'reserved-product-id' };
    if (isInvalidArtifactUrl(err)) return { ok: false, reason: 'invalid-artifact-url' };
    if (isReleaseNotesTooLong(err)) return { ok: false, reason: 'release-notes-too-long' };
    if (isProductIdTooLong(err)) return { ok: false, reason: 'product-id-too-long' };
    if (isVersionTooLong(err)) return { ok: false, reason: 'version-too-long' };
    if (isChannelTooLong(err)) return { ok: false, reason: 'channel-too-long' };
    if (isPlatformTooLong(err)) return { ok: false, reason: 'platform-too-long' };
    if (isChecksumTooLong(err)) return { ok: false, reason: 'checksum-too-long' };
    if (isArtifactUrlTooLong(err)) return { ok: false, reason: 'artifact-url-too-long' };
    if (isDuplicateRelease(err)) return { ok: false, reason: 'duplicate-release' };
    if (isReleaseLimitReached(err)) return { ok: false, reason: 'release-limit-reached' };
    markIfTenantRejected(err, identity.tenantId);
    throw err;
  }
}

export async function unpublishReleaseAction(id: number): Promise<ActionResult<void>> {
  const { identity, tenantApiKey } = await requireSessionWithTenantKey();
  try {
    await unpublishRelease(id, tenantApiKey);
    revalidatePath('/releases');
    return { ok: true, data: undefined };
  } catch (err) {
    if (isRateLimited(err)) return { ok: false, reason: 'rate-limited' };
    markIfTenantRejected(err, identity.tenantId);
    throw err;
  }
}
