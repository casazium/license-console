import type { ReactNode } from 'react';
import { getBranding } from '@/lib/branding';
import { environmentLabel } from '@/lib/config';
import { getBackendVersion } from '@/lib/license-client';
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
  const apiVersion = await getBackendVersion();
  // SaaS-B4: billing is a SaaS-only concept - self-hosted has no
  // subscription/quota at all (quota.js's own MULTI_TENANT-only gate on
  // the server side). session.tenantId is only ever set under
  // MULTI_TENANT (SaaS-B1c), so it doubles as that check here without a
  // separate isMultiTenant() import.
  const showBilling = Boolean(session.tenantId);
  // Same MULTI_TENANT-only gating as showBilling above - self-hosted
  // operators already hold their own ADMIN_API_KEY directly and manage
  // their one shared login via env vars, with nothing on this page for
  // them (app/(app)/settings/page.tsx). Named for the route, not "API
  // access" - the page grew past just the API key (rotation, email/
  // password change, account deletion) and the old name stopped
  // matching what's actually there.
  const showSettingsNav = Boolean(session.tenantId);
  // Same MULTI_TENANT-only gating as showBilling above - self-hosted's
  // single shared admin login has no email/verification concept, so
  // emailVerified is always undefined there and the banner never shows.
  const showEmailVerificationBanner = Boolean(session.tenantId) && session.emailVerified === false;

  return (
    <AppShellClient
      branding={branding}
      appVersion={appVersion}
      apiVersion={apiVersion}
      showBilling={showBilling}
      showSettingsNav={showSettingsNav}
      showEmailVerificationBanner={showEmailVerificationBanner}
      environmentLabel={environmentLabel()}
    >
      {children}
    </AppShellClient>
  );
}
