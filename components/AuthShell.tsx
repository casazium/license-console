import type { ReactNode } from 'react';
import { Anchor, Box, Group, Stack, Text } from '@mantine/core';
import type { Branding } from '@/lib/branding';
import type { AppVersion } from '@/lib/version';
import { BrandLogo } from '@/components/BrandLogo';
import { BrandTitle } from '@/components/BrandTitle';
import { BrandCopyright } from '@/components/BrandCopyright';
import { EnvironmentBanner } from '@/components/EnvironmentBanner';
import { VersionStamp } from '@/components/VersionStamp';
import { environmentLabel } from '@/lib/config';

/**
 * Shared header/form-card/footer shell for the four pre-auth pages
 * (login, signup, forgot-password, reset-password) - extracted from what
 * used to be near-identical markup hand-duplicated across all four (each
 * one independently wrapped its form in the same Box/Stack/Box structure).
 * One place to keep visually aligned with casazium.com's redesign
 * (lib/theme.ts's own header comment has the full rationale) instead of
 * four.
 *
 * `showSupportEmail` defaults false to match each page's own prior,
 * pre-extraction behavior exactly - only app/login/page.tsx rendered the
 * support-email footer link before this extraction; this is a visual
 * refactor, not a behavior change, so that asymmetry is preserved rather
 * than "fixed" as a drive-by.
 */
export function AuthShell({
  branding,
  appVersion,
  belowForm,
  showSupportEmail = false,
  children,
}: {
  branding: Branding;
  appVersion: AppVersion;
  belowForm?: ReactNode;
  showSupportEmail?: boolean;
  children: ReactNode;
}) {
  return (
    <Box
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
        backgroundColor: 'var(--cz-paper)',
        color: 'var(--cz-ink)',
      }}
    >
      <EnvironmentBanner label={environmentLabel()} />
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
        <BrandTitle
          titleHtml={branding.titleHtml}
          isHtml={branding.titleIsHtml}
          style={{
            fontSize: '1.75rem',
            fontWeight: 600,
            letterSpacing: '-0.015em',
            textAlign: 'center',
            color: 'var(--cz-ink)',
          }}
        />
        {/* No wrapping card here - LoginForm/SignupForm/ForgotPasswordForm/
            ResetPasswordForm each already render their own <Card>. An
            earlier version of this shell wrapped that in a second Paper,
            which produced a visible double border and, combined with the
            forms' own fixed Card width, overflowed a 360px viewport -
            confirmed live via a screenshot before removing it. */}
        {children}
        {belowForm}
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
          {showSupportEmail && branding.supportEmail && (
            <>
              <Text size="xs" c="dimmed">
                &middot;
              </Text>
              <Anchor href={`mailto:${branding.supportEmail}`} size="xs" c="dimmed">
                Contact support
              </Anchor>
            </>
          )}
        </Group>
      </Box>
    </Box>
  );
}
