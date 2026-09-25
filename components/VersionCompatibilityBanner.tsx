import { Alert, Text } from '@mantine/core';
import { MIN_COMPATIBLE_SERVER_VERSION } from '@/lib/version';

// Non-blocking by design (SELF_HOSTED_DISTRIBUTION_DESIGN.md §4.4) -
// mirrors casazium/license's own check-sea-release-lag.sh philosophy of
// warning rather than refusing to run: a self-hosting operator's own
// uptime shouldn't depend on this app's release-cadence guesses being
// exactly right. No client interactivity needed, so no 'use client' -
// same reasoning as EnvironmentBanner.
export function VersionCompatibilityBanner({ serverVersion }: { serverVersion: string }) {
  return (
    <Alert color="yellow" mb="md" data-testid="version-compatibility-banner">
      <Text size="sm">
        This console has only been verified against License Server{' '}
        {MIN_COMPATIBLE_SERVER_VERSION} or newer - the connected server reports{' '}
        {serverVersion}, which is older. Some admin features may not work as expected. This is a
        warning, not an error - upgrade your License Server when convenient.
      </Text>
    </Alert>
  );
}
