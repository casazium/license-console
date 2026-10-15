'use server';
import { LicenseApiError } from '@/lib/errors';
export async function rejectedTenantAction() {
  throw new LicenseApiError('Unauthorized', 403);
}
export async function failingAction() {
  throw new Error('action boom');
}
