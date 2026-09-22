import { Box, Text } from '@mantine/core';

// Fixed rather than padding-derived: rendered from two places
// (components/AuthShell.tsx for pre-auth pages, AppShellClient.tsx for
// authenticated pages) that both need to know its exact height ahead of
// time - AppShellClient adds it to AppShell's own `header.height`, which
// Mantine uses to compute every other region's offset (AppShell.Main's
// padding, AppShell.Navbar's top position). A padding-only height here
// would make that math approximate instead of exact.
export const ENVIRONMENT_BANNER_HEIGHT = 28;

// Persistent, hard-to-miss bar - rendered once per page, from whichever
// shell actually wraps that page, not from the root layout. Mantine's
// AppShell renders its header as `position: fixed` to the true viewport
// top, which paints directly over anything placed above it in normal
// document flow - confirmed live: this banner rendered correctly on
// /login (AuthShell, no AppShell) but was completely hidden behind the
// app shell's own header on every authenticated page. Embedding it
// inside AppShell.Header instead (AppShellClient.tsx) puts it under
// Mantine's own layout math rather than fighting fixed positioning.
//
// Off by default: renders nothing unless ENVIRONMENT_LABEL
// (lib/config.ts's environmentLabel()) is explicitly set, so no existing
// deployment - production included - changes unless an operator opts in.
export function EnvironmentBanner({ label }: { label: string | null }) {
  if (!label) {
    return null;
  }

  return (
    <Box
      bg="red.7"
      h={ENVIRONMENT_BANNER_HEIGHT}
      data-testid="environment-banner"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <Text c="white" fw={700} size="sm" tt="uppercase" style={{ letterSpacing: '0.05em' }}>
        {label}
      </Text>
    </Box>
  );
}
