'use server';

import { revalidatePath } from 'next/cache';
import {
  deleteLicense,
  issueLicense,
  reissueActivationToken,
  setLicenseRevoked,
  type IssueLicenseInput,
} from '@/lib/license-client';
import { requireSessionForAction } from '@/lib/session';

export async function issueLicenseAction(input: IssueLicenseInput) {
  await requireSessionForAction();
  const license = await issueLicense(input);
  revalidatePath('/licenses');
  revalidatePath('/dashboard');
  return license;
}

export async function setLicenseRevokedAction(key: string, revoked: boolean) {
  await requireSessionForAction();
  const license = await setLicenseRevoked(key, revoked);
  revalidatePath('/licenses');
  revalidatePath(`/licenses/${key}`);
  revalidatePath('/dashboard');
  return license;
}

export async function deleteLicenseAction(key: string) {
  await requireSessionForAction();
  const ok = await deleteLicense(key);
  revalidatePath('/licenses');
  revalidatePath('/dashboard');
  return ok;
}

export async function reissueActivationTokenAction(key: string, instanceId: string) {
  await requireSessionForAction();
  return reissueActivationToken(key, instanceId);
}
