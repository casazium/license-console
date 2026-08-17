import { Badge, Group, Text } from '@mantine/core';
import { getTierAStatus } from '@/lib/license-client';
import { formatDate } from '@/lib/format';

// Operator asked for this after a real surprise scenario: casazium/license's
// Tier-A activation license (SUPERADMIN_REPORTING_DESIGN.md's sibling
// design work, see that repo's own PROJECT_STATUS.md §134+) can carry a
// real expires_at, but the boot gate that enforces it only ever runs once,
// at startup - a running instance keeps serving requests unchanged right
// through its own expiry, with no warning anywhere, until the next
// restart refuses to come back up. This badge exists so that's never a
// surprise: a countdown once the deadline is close, and an unambiguous
// warning once it's already passed but the instance just hasn't been
// restarted yet.
//
// Same "async Server Component, fetched independently, fail-soft, hide
// entirely when not applicable" shape as SelfLicenseIndicator.tsx - see
// that component's own header comment for the full reasoning (both are
// whole-instance status, not tenant-scoped data, and a failure to reach
// either endpoint must never take down the rest of the dashboard).
const WARNING_THRESHOLD_DAYS = 7;

function daysRemaining(expiresAt: string): number {
  const ms = new Date(expiresAt).getTime() - Date.now();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

export async function TierAStatusIndicator({ tenantApiKey }: { tenantApiKey?: string }) {
  let status;
  try {
    status = await getTierAStatus(tenantApiKey);
  } catch {
    return null;
  }

  if (!status.applicable) {
    return null;
  }

  if (status.status === 'not-configured' || status.status === 'invalid') {
    // Only reachable at all if this instance is up under
    // CASAZIUM_UNLICENSED_EVAL=1 - a genuinely unlicensed, non-eval boot
    // would have refused to start in the first place (see
    // inspectTierALicense()'s own header comment on casazium/license).
    return (
      <Badge color="yellow" variant="light" mb="md">
        Tier-A license: none active - running under a time-limited evaluation allowance
      </Badge>
    );
  }

  if (status.status === 'perpetual') {
    return (
      <Group gap="xs" mb="md">
        <Badge color="green" variant="light">
          Tier-A license: perpetual
        </Badge>
        <Text size="xs" c="dimmed">
          issued to {status.issuedTo}
        </Text>
      </Group>
    );
  }

  if (status.status === 'expired') {
    return (
      <Group gap="xs" mb="md">
        <Badge color="red" variant="filled">
          License Expired: Will not restart
        </Badge>
        <Text size="xs" c="dimmed">
          expired {formatDate(status.expiresAt)} · issued to {status.issuedTo}
        </Text>
      </Group>
    );
  }

  // status.status === 'active'
  const remaining = daysRemaining(status.expiresAt);
  if (remaining < WARNING_THRESHOLD_DAYS) {
    const label = remaining <= 0 ? 'expires today' : remaining === 1 ? 'expires in 1 day' : `expires in ${remaining} days`;
    return (
      <Group gap="xs" mb="md">
        <Badge color="red" variant="light">
          Tier-A license {label}
        </Badge>
        <Text size="xs" c="dimmed">
          {formatDate(status.expiresAt)} · issued to {status.issuedTo}
        </Text>
      </Group>
    );
  }

  return (
    <Group gap="xs" mb="md">
      <Badge color="green" variant="light">
        Tier-A license valid until {formatDate(status.expiresAt)}
      </Badge>
      <Text size="xs" c="dimmed">
        issued to {status.issuedTo}
      </Text>
    </Group>
  );
}
