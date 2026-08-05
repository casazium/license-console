import { notFound } from 'next/navigation';
import { Badge, Stack, Text, Title } from '@mantine/core';
import { getBillingStatus } from '@/lib/license-client';
import { isMultiTenant } from '@/lib/config';
import { isRateLimited } from '@/lib/errors';
import { requireSessionWithTenantKey, markIfTenantRejected } from '@/lib/tenant-context';
import { RateLimitNotice } from '@/components/RateLimitNotice';
import { PlanSelector } from './PlanSelector';

export const dynamic = 'force-dynamic';

const STATUS_COLOR: Record<string, string> = {
  active: 'green',
  past_due: 'yellow',
  canceled: 'red',
};

/**
 * SaaS-B4. Self-hosted has no billing concept at all - 404s here, same
 * posture as app/signup/page.tsx under !isMultiTenant(), not just a
 * missing nav link (AppShellClient.tsx).
 */
export default async function BillingPage() {
  if (!isMultiTenant()) {
    notFound();
  }

  const { identity, tenantApiKey } = await requireSessionWithTenantKey();

  // See dashboard/page.tsx's matching comment - only a rate-limited
  // admin bucket gets a friendly inline message; any other error still
  // throws unchanged.
  let billing;
  try {
    billing = await getBillingStatus(tenantApiKey);
  } catch (err) {
    if (isRateLimited(err)) {
      return (
        <Stack>
          <Title order={2}>Billing</Title>
          <RateLimitNotice />
        </Stack>
      );
    }
    // "Trigger 2" - see dashboard/page.tsx's matching comment.
    markIfTenantRejected(err, identity.tenantId);
    throw err;
  }

  return (
    <Stack maw={480}>
      <Title order={2}>Billing</Title>

      <Stack gap={4}>
        <Text size="sm" c="dimmed">
          Current plan
        </Text>
        <Text size="lg" fw={600}>
          {billing.plan ?? 'Free (default)'}
        </Text>
        <Badge color={STATUS_COLOR[billing.status] ?? 'gray'} w="fit-content">
          {billing.status.replace('_', ' ')}
        </Badge>
      </Stack>

      {billing.status !== 'active' && (
        <Text size="sm" c="red">
          Your subscription is not active - issuing new licenses is blocked
          until this is resolved.
        </Text>
      )}

      <PlanSelector currentPlan={billing.plan} />
    </Stack>
  );
}
