import { Text } from '@mantine/core';

export function BrandCopyright({ holder }: { holder: string | null }) {
  if (!holder) {
    return null;
  }

  const year = new Date().getFullYear();

  return (
    <Text size="xs" c="dimmed" ta="center">
      &copy; {year} {holder}. All rights reserved.
    </Text>
  );
}
