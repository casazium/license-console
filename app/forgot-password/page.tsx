import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Text } from '@mantine/core';
import { isMultiTenant } from '@/lib/config';
import { getBranding } from '@/lib/branding';
import { getAppVersion } from '@/lib/version';
import { AuthShell } from '@/components/AuthShell';
import { ForgotPasswordForm } from './ForgotPasswordForm';

// Same reasoning as app/login/page.tsx: branding is env-configured and
// expected to change without a rebuild.
export const dynamic = 'force-dynamic';

export default function ForgotPasswordPage() {
  // Self-hosted has no accounts/email concept at all - same posture as
  // app/signup/page.tsx under !isMultiTenant().
  if (!isMultiTenant()) {
    notFound();
  }

  const branding = getBranding();
  const appVersion = getAppVersion();

  return (
    <AuthShell
      branding={branding}
      appVersion={appVersion}
      belowForm={
        <Text size="sm" c="dimmed">
          <Link href="/login">Back to sign in</Link>
        </Text>
      }
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
