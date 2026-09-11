import { notFound } from 'next/navigation';
import { Alert, Badge, Progress, Stack, Text, Title } from '@mantine/core';
import { getBillingStatus } from '@/lib/license-client';
import { isMultiTenant } from '@/lib/config';
import { isRateLimited } from '@/lib/errors';
import { formatDate } from '@/lib/format';
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

      {/* Operator-reported gap: canceling from the Stripe Billing Portal
          gave no on-screen sign that anything had happened - status/plan
          deliberately stay at Pro until the subscription actually ends
          (saas-tier.md's documented end-of-period behavior), so without
          this the console looked identical to an active, uncanceled
          subscription for the rest of the billing period. */}
      {billing.cancelAtPeriodEnd && (
        <Alert color="orange" title="Subscription canceled">
          Your Pro subscription has been canceled
          {billing.currentPeriodEnd ? ` and access ends on ${formatDate(billing.currentPeriodEnd)}` : ''}. You&apos;ll
          keep Pro&apos;s limits until then, after which your account reverts to the Free plan.
        </Alert>
      )}

      {/* Beta-readiness finding (BETA_LAUNCH_STATUS.md §4): a tenant
          previously only discovered the plan's license-issuance limit by
          hitting the over-quota error - the same numbers checkQuota()
          enforces server-side (issue-license.js), not a re-derived
          approximation. licensesUsed/licenseLimit are null only under
          self-hosted, which this page already 404s before reaching here
          (isMultiTenant() check above), so no null-guard is needed for
          the arithmetic below. */}
      {billing.licensesUsed !== null && billing.licenseLimit !== null && (
        <Stack gap={4}>
          <Text size="sm" c="dimmed">
            Licenses used
          </Text>
          <Text size="lg" fw={600}>
            {billing.licensesUsed} / {billing.licenseLimit}
          </Text>
          <Progress
            value={(billing.licensesUsed / billing.licenseLimit) * 100}
            color={billing.licensesUsed >= billing.licenseLimit ? 'red' : 'blue'}
          />
        </Stack>
      )}

      <PlanSelector currentPlan={billing.plan} currentStatus={billing.status} />
    </Stack>
  );
}
