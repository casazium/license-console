'use client';

import { Button } from '@mantine/core';
import Link from 'next/link';
import { brandButtonStyle } from '@/components/brandButtonStyle';

// Mantine's Button is itself a Client Component, and RSC forbids passing a
// function (Link, imported from next/link) as a prop across the
// Server -> Client boundary - so `component={Link}` must be wired up here,
// inside a Client Component, not in the Server Component page that renders
// this. Same data-down/client-boundary split already used for LicenseActions
// and the Mantine Table components elsewhere in this app.
export function IssueLicenseButton() {
  return (
    <Button component={Link} href="/licenses/new" style={brandButtonStyle}>
      Issue license
    </Button>
  );
}
