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
  // SaaS-B4: billing is a SaaS-only concept - self-hosted has no
  // subscription/quota at all (quota.js's own MULTI_TENANT-only gate on
  // the server side). session.tenantId is only ever set under
  // MULTI_TENANT (SaaS-B1c), so it doubles as that check here without a
  // separate isMultiTenant() import.
  const showBilling = Boolean(session.tenantId);

  return (
    <AppShellClient branding={branding} appVersion={appVersion} showBilling={showBilling}>
      {children}
    </AppShellClient>
  );
}
