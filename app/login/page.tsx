import Link from 'next/link';
import { Text } from '@mantine/core';
import { isMultiTenant } from '@/lib/config';
import { getBranding } from '@/lib/branding';
import { getAppVersion } from '@/lib/version';
import { AuthShell } from '@/components/AuthShell';
import { LoginForm } from './LoginForm';

// Branding is env-configured and expected to change without a rebuild
// (e.g. a remote BRANDING_LOGO_URL swapped by the operator) - without this,
// Next prerenders the page statically at build time and bakes in whatever
// branding was set then.
export const dynamic = 'force-dynamic';

export default function LoginPage() {
  const branding = getBranding();
  const appVersion = getAppVersion();
  const multiTenant = isMultiTenant();

  return (
    <AuthShell
      branding={branding}
      appVersion={appVersion}
      showSupportEmail
      belowForm={
        multiTenant && (
          <>
            <Text size="sm" c="dimmed">
              <Link href="/forgot-password">Forgot password?</Link>
            </Text>
            <Text size="sm" c="dimmed">
              No account yet? <Link href="/signup">Sign up</Link>
            </Text>
          </>
        )
      }
    >
      <LoginForm multiTenant={multiTenant} />
    </AuthShell>
  );
}
