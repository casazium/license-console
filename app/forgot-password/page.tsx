import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Box, Group, Stack, Text } from '@mantine/core';
import { isMultiTenant } from '@/lib/config';
import { getBranding } from '@/lib/branding';
import { getAppVersion } from '@/lib/version';
import { BrandLogo } from '@/components/BrandLogo';
import { BrandTitle } from '@/components/BrandTitle';
import { BrandCopyright } from '@/components/BrandCopyright';
import { VersionStamp } from '@/components/VersionStamp';
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
    <Box style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {branding.logoUrl && (
        <Box component="header" p="md">
          <BrandLogo logoUrl={branding.logoUrl} size={40} />
        </Box>
      )}
      <Stack
        align="center"
        justify="flex-start"
        gap="lg"
        p="md"
        style={{ flex: 1, paddingTop: 'clamp(24px, 8vh, 96px)' }}
      >
        <BrandTitle titleHtml={branding.titleHtml} style={{ fontSize: '1.75rem', fontWeight: 600, textAlign: 'center' }} />
        <ForgotPasswordForm />
        <Text size="sm" c="dimmed">
          <Link href="/login">Back to sign in</Link>
        </Text>
      </Stack>
      <Box component="footer" p="md">
        <Group justify="center" gap="xs">
          {branding.copyrightHolder && (
            <>
              <BrandCopyright holder={branding.copyrightHolder} />
              <Text size="xs" c="dimmed">
                &middot;
              </Text>
            </>
          )}
          <VersionStamp {...appVersion} />
        </Group>
      </Box>
    </Box>
  );
}
