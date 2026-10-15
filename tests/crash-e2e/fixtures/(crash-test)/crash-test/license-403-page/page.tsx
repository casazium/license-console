import { LicenseApiError } from '@/lib/errors';
export const dynamic = 'force-dynamic';
export default function Page() {
  throw new LicenseApiError('Unauthorized', 403);
}
