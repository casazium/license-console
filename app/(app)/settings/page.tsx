import { notFound } from 'next/navigation';
import { Alert, Anchor, Box, Stack, Text, Title } from '@mantine/core';
import { requireSessionWithTenantKey } from '@/lib/tenant-context';
import { getBranding } from '@/lib/branding';
import { getAccountEmail } from '@/lib/auth';
import { ApiKeyReveal } from './ApiKeyReveal';
import { ApiBaseUrlDisplay } from './ApiBaseUrlDisplay';
import { RotateApiKeySection } from './RotateApiKeySection';
import { ChangePasswordSection } from './ChangePasswordSection';
import { ChangeEmailSection } from './ChangeEmailSection';
import { ExportDataSection } from './ExportDataSection';
import { DeleteAccountSection } from './DeleteAccountSection';

// Beta-readiness finding: nothing in this console ever showed a hosted
// tenant their own API key or the API's real base URL, even though
// signup provisions a real tenant-scoped key (lib/tenant-context.ts's
// getTenantApiKey()) specifically so this tenant can call the license
// server directly, and the public docs (saas-tier.md) tell every signup
// to "get an API key and start issuing licenses." Without this page,
// there was no way to get from "I signed up" to "my application can call
// the API" at all.
export const dynamic = 'force-dynamic';

// Fresh sweep, 2026-08-22: app/api/export-data/route.ts's own header
// explains why its failure paths redirect here with one of these
// values rather than returning a JSON error - its trigger is a plain
// `<a href>` top-level navigation, so a JSON response left the browser
// showing raw error text on a blank page instead of staying on
// Settings.
const EXPORT_ERROR_MESSAGES: Record<string, string> = {
  cooldown: 'Please wait a minute before requesting another export.',
  'rate-limited': 'Too many requests to the license server. Try again shortly.',
  unavailable: 'Data export is only available for hosted accounts.',
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ emailChanged?: string; emailChangeError?: string; exportError?: string }>;
}) {
  const { identity, tenantApiKey } = await requireSessionWithTenantKey();

  // Self-hosted has no per-tenant key concept - the operator already
  // configured their own ADMIN_API_KEY and knows it. Only reachable via
  // direct URL there anyway (AppShellClient only shows this nav item
  // under MULTI_TENANT - see app/(app)/layout.tsx's showSettingsNav).
  if (!tenantApiKey) {
    notFound();
  }

  const apiBaseUrl = (process.env.LICENSE_API_URL ?? '').replace(/\/+$/, '');
  const { supportEmail } = getBranding(identity.tenantId ?? undefined);
  const currentEmail = getAccountEmail(identity.id);

  // Email-change confirmation (app/api/verify-email/route.ts's new_email
  // branch) has no always-on banner to fall back on the way signup
  // verification does (AppShellClient) - this page is the one place
  // that outcome needs to actually reach the person who clicked the
  // link, so it's carried as a one-time query param instead.
  const { emailChanged, emailChangeError, exportError } = await searchParams;
  const exportErrorMessage = exportError ? EXPORT_ERROR_MESSAGES[exportError] : undefined;

  return (
    <Stack maw={640}>
      {emailChanged && (
        <Alert color="teal" variant="light" title="Email changed">
          Your account email is now {currentEmail}.
        </Alert>
      )}
      {emailChangeError && (
        <Alert color="red" variant="light" title="Couldn't change email">
          That confirmation link was invalid, expired, or the address was already taken. Start
          over from the Email section below.
        </Alert>
      )}
      {exportErrorMessage && (
        <Alert color="red" variant="light" title="Couldn't export your data">
          {exportErrorMessage}
        </Alert>
      )}

      <Title order={2} mb="lg">
        Settings
      </Title>

      <Stack gap={4}>
        <Text size="sm" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: '0.05em' }}>
          API
        </Text>
        <Title order={3}>API access</Title>
      </Stack>
      <Text size="sm" c="dimmed">
        Use this API key and base URL to call the License Server directly from your own
        application — it&apos;s the same API a self-hosted deployment uses, scoped to your
        account.
      </Text>

      <ApiKeyReveal apiKey={tenantApiKey} />

      <div>
        <Text size="sm" fw={700} mb={4}>
          API base URL
        </Text>
        <ApiBaseUrlDisplay
          apiBaseUrl={apiBaseUrl}
          fallback={
            <>
              Not configured —{' '}
              {supportEmail ? (
                <Anchor href={`mailto:${supportEmail}`}>contact support</Anchor>
              ) : (
                'contact support'
              )}
            </>
          }
        />
      </div>

      <Text size="sm" c="dimmed">
        See the{' '}
        <Anchor
          href="https://docs.casazium.com/docs/license-server/getting-started/authentication"
          target="_blank"
          rel="noreferrer"
        >
          API authentication docs
        </Anchor>{' '}
        for how to call admin endpoints with this key, or the{' '}
        <Anchor
          href="https://docs.casazium.com/docs/license-server/integration/overview"
          target="_blank"
          rel="noreferrer"
        >
          integration guide
        </Anchor>{' '}
        to activate/verify licenses from your licensed application.
      </Text>

      <RotateApiKeySection />

      <Box mt="xl" pt="lg" style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
        <Text size="sm" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: '0.05em' }}>
          Account
        </Text>
      </Box>
      {currentEmail && <ChangeEmailSection currentEmail={currentEmail} />}
      <ChangePasswordSection />
      <ExportDataSection />
      <DeleteAccountSection />
    </Stack>
  );
}
