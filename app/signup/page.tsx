import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Text } from '@mantine/core';
import { isMultiTenant } from '@/lib/config';
import { getBranding } from '@/lib/branding';
import { getAppVersion } from '@/lib/version';
import { AuthShell } from '@/components/AuthShell';
import { SignupForm } from './SignupForm';

// Same reasoning as app/login/page.tsx: branding is env-configured and
// expected to change without a rebuild.
export const dynamic = 'force-dynamic';

export default function SignupPage() {
  // Self-hosted has no accounts concept - the API route (app/api/signup)
  // already returns 404 under !isMultiTenant(), but that alone would
  // still let this page render a form that always fails on submit. This
  // 404s the page itself, matching the same posture the route takes.
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
          Already have an account? <Link href="/login">Sign in</Link>
        </Text>
      }
    >
      <SignupForm />
    </AuthShell>
  );
}
