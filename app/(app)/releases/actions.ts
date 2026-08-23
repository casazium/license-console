'use server';

import { revalidatePath } from 'next/cache';
import {
  registerRelease,
  unpublishRelease,
  type RegisterReleaseInput,
  type RegisterReleaseResult,
} from '@/lib/license-client';
import { isRateLimited, isProductIdTaken } from '@/lib/errors';
import { requireSessionWithTenantKey, markIfTenantRejected } from '@/lib/tenant-context';

// Same ActionResult<T> shape as app/(app)/licenses/actions.ts, for the
// same reason - a Server Action's thrown-error details are redacted once
// they cross the client boundary, so a rate-limited or product_id-taken
// request has to be caught here and returned as a plain value instead.
type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'rate-limited' | 'product-id-taken' };

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
