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
import { isRateLimited } from '@/lib/errors';
import { requireSessionWithTenantKey } from '@/lib/tenant-context';

// Next.js redacts thrown-error details (message, name, any custom
// properties) once an error crosses a Server Action's return boundary in
// a production build - confirmed directly, both this and a Server
// Component render error come back identically generic client-side. So a
// rate-limited request can't be detected client-side from a thrown
// error's status - it has to be caught here, server-side, and returned
// as a plain value instead. Any other error still throws unchanged (same
// scoping as the read-only pages' matching try/catch).
type ActionResult<T> = { ok: true; data: T } | { ok: false; rateLimited: true };

export async function issueLicenseAction(
  input: IssueLicenseInput,
): Promise<ActionResult<{ key: string }>> {
  const { tenantApiKey } = await requireSessionWithTenantKey();
  try {
    const license = await issueLicense(input, tenantApiKey);
    revalidatePath('/licenses');
    revalidatePath('/dashboard');
    return { ok: true, data: license };
  } catch (err) {
    if (isRateLimited(err)) return { ok: false, rateLimited: true };
    throw err;
  }
}

export async function setLicenseRevokedAction(
  key: string,
  revoked: boolean,
): Promise<ActionResult<void>> {
  const { tenantApiKey } = await requireSessionWithTenantKey();
  try {
    await setLicenseRevoked(key, revoked, tenantApiKey);
    revalidatePath('/licenses');
    revalidatePath(`/licenses/${key}`);
    revalidatePath('/dashboard');
    return { ok: true, data: undefined };
  } catch (err) {
    if (isRateLimited(err)) return { ok: false, rateLimited: true };
    throw err;
  }
}

export async function deleteLicenseAction(key: string): Promise<ActionResult<boolean>> {
  const { tenantApiKey } = await requireSessionWithTenantKey();
  try {
    const deleted = await deleteLicense(key, tenantApiKey);
    revalidatePath('/licenses');
    revalidatePath('/dashboard');
    return { ok: true, data: deleted };
  } catch (err) {
    if (isRateLimited(err)) return { ok: false, rateLimited: true };
    throw err;
  }
}

export async function updateLicenseNotesAction(
  key: string,
  notes: string,
): Promise<ActionResult<void>> {
  const { tenantApiKey } = await requireSessionWithTenantKey();
  try {
    await updateLicenseNotes(key, notes, tenantApiKey);
    revalidatePath(`/licenses/${key}`);
    return { ok: true, data: undefined };
  } catch (err) {
    if (isRateLimited(err)) return { ok: false, rateLimited: true };
    throw err;
  }
}

export async function reissueActivationTokenAction(
  key: string,
  instanceId: string,
): Promise<ActionResult<{ token: string } | null>> {
  const { tenantApiKey } = await requireSessionWithTenantKey();
  try {
    const result = await reissueActivationToken(key, instanceId, tenantApiKey);
    return { ok: true, data: result };
  } catch (err) {
    if (isRateLimited(err)) return { ok: false, rateLimited: true };
    throw err;
  }
}
