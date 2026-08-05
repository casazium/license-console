'use server';

import { revalidatePath } from 'next/cache';
import {
  deleteLicense,
  issueLicense,
  reissueActivationToken,
  setLicenseRevoked,
  updateLicenseNotes,
  type IssueLicenseInput,
} from '@/lib/license-client';
import { isRateLimited, isOverQuota, isPaymentFailed } from '@/lib/errors';
import { requireSessionWithTenantKey, markIfTenantRejected } from '@/lib/tenant-context';

// Next.js redacts thrown-error details (message, name, any custom
// properties) once an error crosses a Server Action's return boundary in
// a production build - confirmed directly, both this and a Server
// Component render error come back identically generic client-side. So a
// rate-limited (or, for issueLicenseAction specifically - SaaS-B4 -
// over-quota/payment-failed) request can't be detected client-side from
// a thrown error's status - it has to be caught here, server-side, and
// returned as a plain value instead. Any other error still throws
// unchanged (same scoping as the read-only pages' matching try/catch).
//
// 'over-quota'/'payment-failed' can only actually come from
// issueLicenseAction (quota.js's check is on POST /issue-license alone) -
// the shared type still includes them so all 5 actions return the same
// shape, not because the other 4 can produce them.
type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'rate-limited' | 'over-quota' | 'payment-failed' };

export async function issueLicenseAction(
  input: IssueLicenseInput,
): Promise<ActionResult<{ key: string }>> {
  const { identity, tenantApiKey } = await requireSessionWithTenantKey();
  try {
    const license = await issueLicense(input, tenantApiKey);
    revalidatePath('/licenses');
    revalidatePath('/dashboard');
    return { ok: true, data: license };
  } catch (err) {
    if (isRateLimited(err)) return { ok: false, reason: 'rate-limited' };
    if (isOverQuota(err)) return { ok: false, reason: 'over-quota' };
    if (isPaymentFailed(err)) return { ok: false, reason: 'payment-failed' };
    markIfTenantRejected(err, identity.tenantId);
    throw err;
  }
}

export async function setLicenseRevokedAction(
  key: string,
  revoked: boolean,
): Promise<ActionResult<void>> {
  const { identity, tenantApiKey } = await requireSessionWithTenantKey();
  try {
    await setLicenseRevoked(key, revoked, tenantApiKey);
    revalidatePath('/licenses');
    revalidatePath(`/licenses/${key}`);
    revalidatePath('/dashboard');
    return { ok: true, data: undefined };
  } catch (err) {
    if (isRateLimited(err)) return { ok: false, reason: 'rate-limited' };
    markIfTenantRejected(err, identity.tenantId);
    throw err;
  }
}

export async function deleteLicenseAction(key: string): Promise<ActionResult<boolean>> {
  const { identity, tenantApiKey } = await requireSessionWithTenantKey();
  try {
    const deleted = await deleteLicense(key, tenantApiKey);
    revalidatePath('/licenses');
    revalidatePath('/dashboard');
    return { ok: true, data: deleted };
  } catch (err) {
    if (isRateLimited(err)) return { ok: false, reason: 'rate-limited' };
    markIfTenantRejected(err, identity.tenantId);
    throw err;
  }
}

export async function updateLicenseNotesAction(
  key: string,
  notes: string,
): Promise<ActionResult<void>> {
  const { identity, tenantApiKey } = await requireSessionWithTenantKey();
  try {
    await updateLicenseNotes(key, notes, tenantApiKey);
    revalidatePath(`/licenses/${key}`);
    return { ok: true, data: undefined };
  } catch (err) {
    if (isRateLimited(err)) return { ok: false, reason: 'rate-limited' };
    markIfTenantRejected(err, identity.tenantId);
    throw err;
  }
}

export async function reissueActivationTokenAction(
  key: string,
  instanceId: string,
): Promise<ActionResult<{ token: string } | null>> {
  const { identity, tenantApiKey } = await requireSessionWithTenantKey();
  try {
    const result = await reissueActivationToken(key, instanceId, tenantApiKey);
    return { ok: true, data: result };
  } catch (err) {
    if (isRateLimited(err)) return { ok: false, reason: 'rate-limited' };
    markIfTenantRejected(err, identity.tenantId);
    throw err;
  }
}
