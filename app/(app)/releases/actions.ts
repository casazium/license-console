'use server';

import { revalidatePath } from 'next/cache';
import {
  registerRelease,
  unpublishRelease,
  type RegisterReleaseInput,
  type RegisterReleaseResult,
} from '@/lib/license-client';
import { isRateLimited, isProductIdTaken, isPaymentFailed, isReservedProductId } from '@/lib/errors';
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
type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'rate-limited' | 'product-id-taken' | 'payment-failed' | 'reserved-product-id' };

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
