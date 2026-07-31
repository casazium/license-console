import { Box, Stack } from '@mantine/core';
import { getBranding } from '@/lib/branding';
import { BrandLogo } from '@/components/BrandLogo';
import { BrandTitle } from '@/components/BrandTitle';
import { BrandCopyright } from '@/components/BrandCopyright';
import { LoginForm } from './LoginForm';

// Branding is env-configured and expected to change without a rebuild
// (e.g. a remote BRANDING_LOGO_URL swapped by the operator) - without this,
// Next prerenders the page statically at build time and bakes in whatever
// branding was set then.
export const dynamic = 'force-dynamic';

export default function LoginPage() {
  const branding = getBranding();

  return (
    <Box style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {branding.logoUrl && (
        <Box component="header" p="md">
          <BrandLogo logoUrl={branding.logoUrl} size={40} />
        </Box>
      )}
      <Stack align="center" justify="center" gap="lg" p="md" style={{ flex: 1 }}>
        <BrandTitle titleHtml={branding.titleHtml} style={{ fontSize: '1.75rem', fontWeight: 600, textAlign: 'center' }} />
        <LoginForm />
      </Stack>
      {branding.copyrightHolder && (
        <Box component="footer" p="md">
          <BrandCopyright holder={branding.copyrightHolder} />
        </Box>
      )}
    </Box>
  );
}
