import type { ReactNode } from 'react';
import { getBranding } from '@/lib/branding';
import { AppShellClient } from './AppShellClient';

// Branding is env-configured and expected to change without a rebuild.
// Without this, some child routes with no other dynamic data dependency
// (e.g. /licenses/new) would get prerendered statically and bake in
// whatever branding was set at build time.
export const dynamic = 'force-dynamic';

export default function AppLayout({ children }: { children: ReactNode }) {
  const branding = getBranding();

  return <AppShellClient branding={branding}>{children}</AppShellClient>;
}
