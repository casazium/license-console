import { Text } from '@mantine/core';
import type { AppVersion } from '@/lib/version';
import type { BackendVersion } from '@/lib/license-client';

type VersionStampProps = AppVersion & {
  // Omitted entirely on pages that don't fetch it (pre-auth pages -
  // showing the connected License Server's own version to a signed-out
  // visitor has no real value and would add an extra backend round trip
  // to pages that don't otherwise need one), and null when a live
  // backend couldn't be reached. Either way, rendered as if it weren't
  // there at all rather than as an "unknown" placeholder.
  apiVersion?: BackendVersion;
};

export function VersionStamp({ version, gitSha, apiVersion }: VersionStampProps) {
  return (
    <Text size="xs" c="dimmed" ff="monospace" title={`commit ${gitSha}`}>
      v{version}
      {apiVersion ? ` · API v${apiVersion.version}` : null}
    </Text>
  );
}
