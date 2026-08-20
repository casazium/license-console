import { notFound } from 'next/navigation';
import { Box, Group, Stack, Text } from '@mantine/core';
import { isMultiTenant } from '@/lib/config';
import { getBranding } from '@/lib/branding';
import { getAppVersion } from '@/lib/version';
import { BrandLogo } from '@/components/BrandLogo';
import { BrandTitle } from '@/components/BrandTitle';
import { BrandCopyright } from '@/components/BrandCopyright';
import { VersionStamp } from '@/components/VersionStamp';
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
    <Box style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {branding.logoUrl && (
        <Box component="header" p="md">
          <BrandLogo logoUrl={branding.logoUrl} linkUrl={branding.logoLinkUrl} size={40} />
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
        <ResetPasswordForm token={token} />
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
