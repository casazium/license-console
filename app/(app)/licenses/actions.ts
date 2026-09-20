'use server';

import { revalidatePath } from 'next/cache';
import {
  buildPortalLink,
  deactivateByInstanceId,
  deleteLicense,
  issueLicense,
  reissueActivationToken,
  reissuePortalToken,
  setLicenseRevoked,
  updateLicenseNotes,
  updateLicenseTerms,
  type IssueLicenseInput,
  type UpdateLicenseTermsInput,
  type UpdateLicenseTermsResult,
} from '@/lib/license-client';
import { isRateLimited, isOverQuota, isPaymentFailed, isProductIdTaken, isProductIdRetired } from '@/lib/errors';
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
// 'over-quota'/'payment-failed'/'product-id-taken'/'product-id-retired'
// can only actually come from issueLicenseAction (quota.js's check and
// the product_id ownership check are both on POST /issue-license alone) -
// the shared type still includes them so all 5 actions return the same
// shape, not because the other 4 can produce them.
//
// 'product-id-retired' added (security review finding, fresh audit,
// 2026-09 - permanent product_id retirement, operator follow-up
// "distinguish the two cases"): a retired product_id is a distinct 403
// from 'product-id-taken' - nobody owns it, an admin has to release it -
// and needs its own UI copy rather than the misleading "pick a different
// account" framing 'product-id-taken' uses.
type ActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      reason: 'rate-limited' | 'over-quota' | 'payment-failed' | 'product-id-taken' | 'product-id-retired';
    };

export async function issueLicenseAction(
  input: IssueLicenseInput,
): Promise<ActionResult<{ key: string; portalToken: string; portalLink: string | null }>> {
  const { identity, tenantApiKey } = await requireSessionWithTenantKey();
  try {
    const license = await issueLicense(input, tenantApiKey);
    revalidatePath('/licenses');
    revalidatePath('/dashboard');
    return { ok: true, data: { ...license, portalLink: buildPortalLink(license.portalToken) } };
  } catch (err) {
    if (isRateLimited(err)) return { ok: false, reason: 'rate-limited' };
    if (isOverQuota(err)) return { ok: false, reason: 'over-quota' };
    if (isPaymentFailed(err)) return { ok: false, reason: 'payment-failed' };
    if (isProductIdTaken(err)) return { ok: false, reason: 'product-id-taken' };
    if (isProductIdRetired(err)) return { ok: false, reason: 'product-id-retired' };
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

export async function updateLicenseTermsAction(
  input: UpdateLicenseTermsInput,
): Promise<ActionResult<UpdateLicenseTermsResult>> {
  const { identity, tenantApiKey } = await requireSessionWithTenantKey();
  try {
    const result = await updateLicenseTerms(input, tenantApiKey);
    // Both the detail page (shows the terms directly) and the list page
    // (Expires/Seats columns) and dashboard (expiring-soon, near-seat-
    // limit widgets) all derive from these same fields.
    revalidatePath(`/licenses/${input.key}`);
    revalidatePath('/licenses');
    revalidatePath('/dashboard');
    return { ok: true, data: result };
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

// TASK_A1_LICENSE_PORTAL.md - the end-user license portal's own
// credential. Same additive shape as reissueActivationTokenAction above;
// this is the console's one change for that task (a new admin action,
// no change to any existing route's behavior).
export async function reissuePortalTokenAction(
  key: string,
): Promise<ActionResult<{ portalToken: string; portalLink: string | null } | null>> {
  const { identity, tenantApiKey } = await requireSessionWithTenantKey();
  try {
    const result = await reissuePortalToken(key, tenantApiKey);
    return {
      ok: true,
      data: result ? { ...result, portalLink: buildPortalLink(result.portalToken) } : null,
    };
  } catch (err) {
    if (isRateLimited(err)) return { ok: false, reason: 'rate-limited' };
    markIfTenantRejected(err, identity.tenantId);
    throw err;
  }
}

export async function deactivateByInstanceIdAction(
  key: string,
  instanceId: string,
): Promise<ActionResult<boolean | null>> {
  const { identity, tenantApiKey } = await requireSessionWithTenantKey();
  try {
    const result = await deactivateByInstanceId(key, instanceId, tenantApiKey);
    revalidatePath(`/licenses/${key}`);
    return { ok: true, data: result };
  } catch (err) {
    if (isRateLimited(err)) return { ok: false, reason: 'rate-limited' };
    markIfTenantRejected(err, identity.tenantId);
    throw err;
  }
}
