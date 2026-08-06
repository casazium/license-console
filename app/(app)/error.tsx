'use client';

// Beta-readiness finding: there was no error boundary anywhere in this
// app, so a license-server hiccup (a 500, a dropped connection, a
// timeout - see license-client.live.ts's new liveFetch timeout) surfaced
// as Next's own raw, unbranded "Application error: a server-side
// exception has occurred" page, with no nav, no explanation, and no way
// back in. This only catches errors thrown by pages/components *nested
// under* app/(app)/layout.tsx - not by that layout itself (Next.js never
// routes a segment's own layout errors to that same segment's
// error.tsx), which is what the root app/error.tsx is for.

import { useEffect } from 'react';
import Link from 'next/link';
import { Button, Group, Stack, Text, Title } from '@mantine/core';

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('Console app error:', error);
  }, [error]);

  return (
    <Stack align="center" justify="center" gap="sm" py="xl">
      <Title order={3}>Something went wrong</Title>
      <Text c="dimmed" size="sm" ta="center" maw={420}>
        This page hit an unexpected error - it may be temporary (a slow or unavailable license
        server). You can try again, or head back to the dashboard.
      </Text>
      <Group>
        <Button onClick={reset}>Try again</Button>
        <Button component={Link} href="/dashboard" variant="default">
          Back to dashboard
        </Button>
        <Button component={Link} href="/login" variant="subtle">
          Sign in again
        </Button>
      </Group>
    </Stack>
  );
}
