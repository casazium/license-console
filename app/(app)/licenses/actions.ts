'use server';

import { revalidatePath } from 'next/cache';
import {
  deleteLicense,
  issueLicense,
  reissueActivationToken,
  setLicenseRevoked,
  type IssueLicenseInput,
} from '@/lib/license-client';
import { isRateLimited } from '@/lib/errors';
import { requireSessionForAction } from '@/lib/session';

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
  await requireSessionForAction();
  try {
    const license = await issueLicense(input);
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
  await requireSessionForAction();
  try {
    await setLicenseRevoked(key, revoked);
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
  await requireSessionForAction();
  try {
    const deleted = await deleteLicense(key);
    revalidatePath('/licenses');
    revalidatePath('/dashboard');
    return { ok: true, data: deleted };
  } catch (err) {
    if (isRateLimited(err)) return { ok: false, rateLimited: true };
    throw err;
  }
}

export async function reissueActivationTokenAction(
  key: string,
  instanceId: string,
): Promise<ActionResult<{ token: string } | null>> {
  await requireSessionForAction();
  try {
    const result = await reissueActivationToken(key, instanceId);
    return { ok: true, data: result };
  } catch (err) {
    if (isRateLimited(err)) return { ok: false, rateLimited: true };
    throw err;
  }
}
