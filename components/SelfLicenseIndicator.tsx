import { Badge, Group, Text } from '@mantine/core';
import { getSelfLicenseStatus } from '@/lib/license-client';
import { formatDateTime } from '@/lib/format';

// Subscription-expiry warning, alongside (not instead of) the call-home
// health badges below - the two are orthogonal: call-home can be
// currently succeeding (a still-valid cached credential renews itself
// automatically) while the underlying subscription is days from lapsing,
// since the rolling ~14-day credential cache window and the real
// subscription end date are entirely different timers - see
// SelfLicenseOutcome's own subscriptionExpiresAt doc comment
// (lib/license-types.ts). Mirrors TierAStatusIndicator's own thresholds
// exactly, for the same operator-facing reason: no surprise once a
// license runs out.
const WARNING_THRESHOLD_DAYS = 7;

function daysRemaining(expiresAt: string): number {
  const ms = new Date(expiresAt).getTime() - Date.now();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

// Renders nothing when the subscription isn't close to lapsing - the
// existing "verified · valid until <date>" text on the primary badge
// already covers the healthy case; a second always-on badge would be
// redundant there. Only speaks up once there's something to warn about.
function SubscriptionExpiryWarning({ subscriptionExpiresAt }: { subscriptionExpiresAt: string }) {
  const remaining = daysRemaining(subscriptionExpiresAt);

  if (remaining < 0) {
    // The genuinely surprising case this exists for: the cached ~14-day
    // credential is still valid (call-home hasn't needed to re-run since
    // the subscription lapsed), so lastOutcome still reads 'success' -
    // but the *next* renewal will fail with no warning unless this says
    // so now.
    return (
      <Group gap="xs" mb="md">
        <Badge color="red" variant="filled">
          Self-License Subscription Expired
        </Badge>
        <Text size="xs" c="dimmed">
          expired {formatDateTime(subscriptionExpiresAt)} - the next renewal will fail
        </Text>
      </Group>
    );
  }

  if (remaining < WARNING_THRESHOLD_DAYS) {
    const label = remaining === 0 ? 'expires today' : remaining === 1 ? 'expires in 1 day' : `expires in ${remaining} days`;
    return (
      <Group gap="xs" mb="md">
        <Badge color="red" variant="light">
          Self-license subscription {label}
        </Badge>
        <Text size="xs" c="dimmed">{formatDateTime(subscriptionExpiresAt)}</Text>
      </Group>
    );
  }

  return null;
}

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
      <>
        <Group gap="xs" mb="md">
          <Badge color="green" variant="light">
            Self-license verified
          </Badge>
          <Text size="xs" c="dimmed">
            {formatDateTime(lastOutcome.at)}
            {lastOutcome.expiresAt ? ` · valid until ${formatDateTime(lastOutcome.expiresAt)}` : ''}
          </Text>
        </Group>
        {lastOutcome.subscriptionExpiresAt && (
          <SubscriptionExpiryWarning subscriptionExpiresAt={lastOutcome.subscriptionExpiresAt} />
        )}
      </>
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

  // 'misconfigured' and 'load-error' both mean a call-home was never
  // attempted at all - they used to fall into the same "check-in
  // failed" branch below, which is inaccurate for either (no check-in
  // was ever made to fail) and actively misleading for 'misconfigured'
  // specifically: a final build (casazium/license PROJECT_STATUS.md
  // §192, LICENSE §8) deliberately runs with no SELF_LICENSE_KEY set,
  // which reports this exact outcome forever, by design - not a
  // transient problem. Neutral (not red-alarm) styling here, since this
  // state is equally reachable by an operator who genuinely forgot to
  // configure a real Tier-B key or whose persistent volume isn't
  // mounted (ensureInstanceKey's own failure path also reports
  // 'misconfigured') - the error text still surfaces that case, just
  // without implying an ongoing, actively-failing connection.
  if (lastOutcome.outcome === 'misconfigured') {
    return (
      <Group gap="xs" mb="md">
        <Badge color="gray" variant="light">
          Self-license: not active
        </Badge>
        <Text size="xs" c="dimmed">
          {formatDateTime(lastOutcome.at)}
          {lastOutcome.error ? `: ${lastOutcome.error}` : ''}
        </Text>
      </Group>
    );
  }

  // 'load-error' - the native module file is present but failed to
  // load (a broken build, not a missing/wrong key) - unlike
  // 'misconfigured' above, this has no benign explanation, so it keeps
  // the red alarm styling.
  if (lastOutcome.outcome === 'load-error') {
    return (
      <Group gap="xs" mb="md">
        <Badge color="red" variant="light">
          Self-license module failed to load
        </Badge>
        <Text size="xs" c="dimmed">
          {formatDateTime(lastOutcome.at)}
          {lastOutcome.error ? `: ${lastOutcome.error}` : ''}
        </Text>
      </Group>
    );
  }

  // lastOutcome.outcome === 'failure' - a real call-home attempt was
  // made and failed (attemptCallHome()'s own catch block) - this is the
  // only outcome where "check-in failed" is actually accurate.
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
