import Link from 'next/link';
import { Box, Group, Stack, Text } from '@mantine/core';
import { isMultiTenant } from '@/lib/config';
import { getBranding } from '@/lib/branding';
import { getAppVersion } from '@/lib/version';
import { BrandLogo } from '@/components/BrandLogo';
import { BrandTitle } from '@/components/BrandTitle';
import { BrandCopyright } from '@/components/BrandCopyright';
import { VersionStamp } from '@/components/VersionStamp';
import { LoginForm } from './LoginForm';

// Branding is env-configured and expected to change without a rebuild
// (e.g. a remote BRANDING_LOGO_URL swapped by the operator) - without this,
// Next prerenders the page statically at build time and bakes in whatever
// branding was set then.
export const dynamic = 'force-dynamic';

export default function LoginPage() {
  const branding = getBranding();
  const appVersion = getAppVersion();

  return (
    <Box style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {branding.logoUrl && (
        <Box component="header" p="md">
          <BrandLogo logoUrl={branding.logoUrl} linkUrl={branding.logoLinkUrl} size={40} />
        </Box>
      )}
      {/*
        justify="flex-start" + a clamped top offset, not justify="center":
        centering within the full remaining viewport height put a huge,
        viewport-height-dependent gap above the title on tall screens (the
        block centers in leftover space that can be 1000px+ tall). A capped
        offset keeps the title a consistent, comfortable distance below the
        header regardless of viewport height, and any excess space collects
        below the card instead of splitting evenly above and below it.
      */}
      <Stack
        align="center"
        justify="flex-start"
        gap="lg"
        p="md"
        style={{ flex: 1, paddingTop: 'clamp(24px, 8vh, 96px)' }}
      >
        <BrandTitle titleHtml={branding.titleHtml} isHtml={branding.titleIsHtml} style={{ fontSize: '1.75rem', fontWeight: 600, textAlign: 'center' }} />
        <LoginForm multiTenant={isMultiTenant()} />
        {isMultiTenant() && (
          <>
            <Text size="sm" c="dimmed">
              <Link href="/forgot-password">Forgot password?</Link>
            </Text>
            <Text size="sm" c="dimmed">
              No account yet? <Link href="/signup">Sign up</Link>
            </Text>
          </>
        )}
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
