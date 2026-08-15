import { Badge, Group, Text } from '@mantine/core';
import { getSelfLicenseStatus } from '@/lib/license-client';
import { formatDateTime } from '@/lib/format';

// Beta-testing visibility indicator (RUST_CALL_HOME_DESIGN.md §9 step 4,
// casazium/license PROJECT_STATUS.md) - previously the only way to know
// whether a connected Tier-B backend's call-home was actually succeeding
// was to read its raw container logs. Deliberately on the post-login
// dashboard, not the login page: a coarse "is this subscription current"
// signal is a minor information leak to an unauthenticated visitor if
// shown pre-login, so this stays behind the same session gate as
// everything else on this page.
//
// Async Server Component, fetched independently of the dashboard's own
// Promise.all batch (page.tsx) rather than folded into it - a failure to
// reach this one endpoint must never take down the rest of the
// dashboard, same fail-soft posture as the self-license mechanism itself
// on the backend. Renders nothing at all for the common case
// (tier: 'tier-a' - most deployments aren't Tier-B), consistent with
// MockDataNotice's own "decide my own visibility, render null when not
// applicable" pattern.
export async function SelfLicenseIndicator({ tenantApiKey }: { tenantApiKey?: string }) {
  let status;
  try {
    status = await getSelfLicenseStatus(tenantApiKey);
  } catch {
    return null;
  }

  if (status.tier === 'tier-a') {
    return null;
  }

  const { lastOutcome } = status;

  if (!lastOutcome) {
    return (
      <Badge color="gray" variant="light" mb="md">
        Self-license: pending first check-in
      </Badge>
    );
  }

  if (lastOutcome.outcome === 'success') {
    return (
      <Group gap="xs" mb="md">
        <Badge color="green" variant="light">
          Self-license verified
        </Badge>
        <Text size="xs" c="dimmed">
          {formatDateTime(lastOutcome.at)}
          {lastOutcome.expiresAt ? ` · valid until ${formatDateTime(lastOutcome.expiresAt)}` : ''}
        </Text>
      </Group>
    );
  }

  // A real, meaningfully different state from both 'success' and no
  // lastOutcome at all: the backend found a still-valid cached
  // credential on this boot and skipped a fresh call-home entirely (see
  // that repo's own recordOutcome('restored') call site) - not "never
  // checked in," but also not a fresh verification this exact boot.
  // `at` is honestly labeled as this boot's confirmation time, not the
  // credential's original issuance time, since the backend has no way
  // to report the latter (no napi export surfaces it).
  if (lastOutcome.outcome === 'restored') {
    return (
      <Group gap="xs" mb="md">
        <Badge color="blue" variant="light">
          Self-license: using cached credential
        </Badge>
        <Text size="xs" c="dimmed">
          confirmed still valid as of {formatDateTime(lastOutcome.at)}
        </Text>
      </Group>
    );
  }

  return (
    <Group gap="xs" mb="md">
      <Badge color="red" variant="light">
        Self-license check-in failed
      </Badge>
      <Text size="xs" c="dimmed">
        {formatDateTime(lastOutcome.at)}
        {lastOutcome.error ? `: ${lastOutcome.error}` : ''}
      </Text>
    </Group>
  );
}
