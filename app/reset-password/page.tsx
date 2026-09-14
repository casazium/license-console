import { notFound } from 'next/navigation';
import { isMultiTenant } from '@/lib/config';
import { getBranding } from '@/lib/branding';
import { getAppVersion } from '@/lib/version';
import { AuthShell } from '@/components/AuthShell';
import { ResetPasswordForm } from './ResetPasswordForm';

export const dynamic = 'force-dynamic';

/**
 * Reached from the link app/api/forgot-password sends by email. Unlike
 * app/api/verify-email (a GET the email client opens directly, which
 * completes the action itself), this page just renders a form - the
 * actual reset needs a new password value, which a GET link can't
 * safely carry, so app/api/reset-password/route.ts is where the token
 * actually gets validated and consumed.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  if (!isMultiTenant()) {
    notFound();
  }

  const { token } = await searchParams;
  if (!token) {
    notFound();
  }

  const branding = getBranding();
  const appVersion = getAppVersion();

  return (
    <AuthShell branding={branding} appVersion={appVersion}>
      <ResetPasswordForm token={token} />
    </AuthShell>
  );
}
