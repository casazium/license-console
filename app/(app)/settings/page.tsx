import { notFound } from 'next/navigation';
import { Anchor, Code, Stack, Text, Title } from '@mantine/core';
import { requireSessionWithTenantKey } from '@/lib/tenant-context';
import { getBranding } from '@/lib/branding';
import { ApiKeyReveal } from './ApiKeyReveal';
import { RotateApiKeySection } from './RotateApiKeySection';
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

export default async function SettingsPage() {
  const { identity, tenantApiKey } = await requireSessionWithTenantKey();

  // Self-hosted has no per-tenant key concept - the operator already
  // configured their own ADMIN_API_KEY and knows it. Only reachable via
  // direct URL there anyway (AppShellClient only shows this nav item
  // under MULTI_TENANT - see app/(app)/layout.tsx's showApiSettings).
  if (!tenantApiKey) {
    notFound();
  }

  const apiBaseUrl = (process.env.LICENSE_API_URL ?? '').replace(/\/+$/, '');
  const { supportEmail } = getBranding(identity.tenantId ?? undefined);

  return (
    <Stack maw={640}>
      <Title order={2}>API access</Title>
      <Text size="sm" c="dimmed">
        Use this API key and base URL to call the License Server directly from your own
        application - it&apos;s the same API a self-hosted deployment uses, scoped to your
        account.
      </Text>

      <ApiKeyReveal apiKey={tenantApiKey} />

      <div>
        <Text size="sm" fw={700} mb={4}>
          API base URL
        </Text>
        <Code block>
          {apiBaseUrl || (
            <>
              Not configured -{' '}
              {supportEmail ? (
                <Anchor href={`mailto:${supportEmail}`}>contact support</Anchor>
              ) : (
                'contact support'
              )}
            </>
          )}
        </Code>
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
      <DeleteAccountSection />
    </Stack>
  );
}
