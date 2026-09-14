import { Text } from '@mantine/core';
import type { AppVersion } from '@/lib/version';

export function VersionStamp({ version, gitSha }: AppVersion) {
  return (
    <Text size="xs" c="dimmed" ff="monospace" title={`commit ${gitSha}`}>
      v{version}
    </Text>
  );
}
