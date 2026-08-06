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
        <BrandTitle titleHtml={branding.titleHtml} isHtml={branding.titleIsHtml} style={{ fontSize: '1.75rem', fontWeight: 600, textAlign: 'center' }} />
        <SignupForm />
        <Text size="sm" c="dimmed">
          Already have an account? <Link href="/login">Sign in</Link>
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
