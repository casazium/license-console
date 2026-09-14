import { Text } from '@mantine/core';

export function BrandCopyright({ holder }: { holder: string | null }) {
  if (!holder) {
    return null;
  }

  const year = new Date().getFullYear();

  return (
    <Text size="xs" c="dimmed" ta="center" ff="monospace">
      &copy; {year} {holder}. All rights reserved.
    </Text>
  );
}
