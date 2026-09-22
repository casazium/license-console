import { Box, Text } from '@mantine/core';

// Persistent, hard-to-miss bar across every page (wired in app/layout.tsx,
// above both pre-auth and authenticated content) - production/test
// confusion is a real failure mode this exists to prevent. Off by
// default: renders nothing unless ENVIRONMENT_LABEL
// (lib/config.ts's environmentLabel()) is explicitly set, so no existing
// deployment - production included - changes unless an operator opts in.
export function EnvironmentBanner({ label }: { label: string | null }) {
  if (!label) {
    return null;
  }

  return (
    <Box bg="red.7" py={6} ta="center" data-testid="environment-banner">
      <Text c="white" fw={700} size="sm" tt="uppercase" style={{ letterSpacing: '0.05em' }}>
        {label}
      </Text>
    </Box>
  );
}
