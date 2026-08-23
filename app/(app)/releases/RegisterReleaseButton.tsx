'use client';

import { Button } from '@mantine/core';
import Link from 'next/link';
import { brandButtonStyle } from '@/components/brandButtonStyle';

// Mirrors app/(app)/licenses/IssueLicenseButton.tsx - see its own
// comment for why `component={Link}` has to be wired up in a Client
// Component rather than the Server Component page that renders this.
export function RegisterReleaseButton() {
  return (
    <Button component={Link} href="/releases/new" style={brandButtonStyle}>
      Register release
    </Button>
  );
}
