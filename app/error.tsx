'use client';

// Root-level fallback (see app/(app)/error.tsx's comment for the split):
// this is what actually catches app/(app)/layout.tsx's own errors (e.g.
// requireSession() failing) since a segment's error.tsx never catches
// errors thrown by that same segment's layout. Deliberately has no
// dependency on branding/session data - by the time this renders, the
// thing that fetches that data is exactly what may have failed.

import { useEffect } from 'react';
import { Button, Stack, Text, Title } from '@mantine/core';

export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('Console root error:', error);
  }, [error]);

  return (
    <Stack align="center" justify="center" gap="sm" py="xl" mih="60vh">
      <Title order={3}>Something went wrong</Title>
      <Text c="dimmed" size="sm" ta="center" maw={420}>
        The console hit an unexpected error. Try again, or sign in again if you were signed out.
      </Text>
      <Stack gap="xs" align="center">
        <Button onClick={reset}>Try again</Button>
        <Button component="a" href="/login" variant="subtle">
          Go to sign in
        </Button>
      </Stack>
    </Stack>
  );
}
