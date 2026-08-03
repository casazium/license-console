import { Text } from '@mantine/core';
import type { AppVersion } from '@/lib/version';

export function VersionStamp({ version, gitSha }: AppVersion) {
  return (
    <Text size="xs" c="dimmed" title={`commit ${gitSha}`}>
      v{version}
    </Text>
  );
}
