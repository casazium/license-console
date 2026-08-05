import { notFound } from 'next/navigation';
import { Stack, Text } from '@mantine/core';
import { isMultiTenant } from '@/lib/config';
import { requireSession } from '@/lib/session';
import { getTenantName } from '@/lib/tenant-context';
import { IssueLicenseForm } from '../licenses/IssueLicenseForm';

export const dynamic = 'force-dynamic';

/**
 * SaaS-B5. Every successful signup (SaaS-B1b) provisions a brand new,
 * license-less tenant - there is no existing-tenant case to distinguish,
 * so signup always redirects here rather than needing an "already
 * onboarded" flag to check. Self-hosted has no signup at all - 404s
 * here too, same posture as /signup and /billing.
 *
 * Doubles as the original "interactive demo" ask (§2's original plan):
 * a prospect walking through real signup and issuing a real first
 * license *is* the demo, not a separate build - which is also why this
 * reuses the exact same IssueLicenseForm the regular /licenses/new page
 * uses, landing on the same license detail page afterward (which
 * already shows the "how to activate this license" snippet) rather
 * than inventing a second, parallel completion step.
 */
export default async function OnboardingPage() {
  if (!isMultiTenant()) {
    notFound();
  }

  const identity = await requireSession();
  const tenantName = getTenantName(identity.id);

  return (
    <Stack maw={480}>
      <Stack gap={4}>
        <Text size="xl" fw={700}>
          {tenantName ? `Welcome, ${tenantName}!` : 'Welcome!'}
        </Text>
        <Text c="dimmed">
          Let&rsquo;s issue your first license to get started. You&rsquo;ll be able to
          activate it from your application right after.
        </Text>
      </Stack>

      <IssueLicenseForm
        heading="Issue your first license"
        submitLabel="Issue my first license"
        skipHref="/dashboard"
      />
    </Stack>
  );
}
