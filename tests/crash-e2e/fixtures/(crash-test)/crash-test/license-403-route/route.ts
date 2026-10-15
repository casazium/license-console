import { LicenseApiError } from '@/lib/errors';
export const dynamic = 'force-dynamic';
export async function GET() {
  throw new LicenseApiError('Unauthorized', 403);
}
