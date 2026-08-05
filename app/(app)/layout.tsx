import type { ReactNode } from 'react';
import { getBranding } from '@/lib/branding';
import { getAppVersion } from '@/lib/version';
import { requireSession } from '@/lib/session';
import { AppShellClient } from './AppShellClient';

// Branding is env-configured and expected to change without a rebuild.
// Without this, some child routes with no other dynamic data dependency
// (e.g. /licenses/new) would get prerendered statically and bake in
// whatever branding was set at build time.
export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: ReactNode }) {
  // requireSession(), not getSession() (SaaS-B3): unlike the root layout,
  // every route under this one is already gated by proxy.ts, so a
  // session is always expected here - fail loud if that's ever untrue
  // instead of silently rendering platform branding for what should be a
  // tenant's own page.
  const session = await requireSession();
  const branding = getBranding(session.tenantId);
  const appVersion = getAppVersion();

  return (
    <AppShellClient branding={branding} appVersion={appVersion}>
      {children}
    </AppShellClient>
  );
}
