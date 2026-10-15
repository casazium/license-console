import { LicenseApiError } from '@/lib/errors';
export const dynamic = 'force-dynamic';
export async function GET() {
  throw new LicenseApiError('expires_at must be a date', 400);
}
