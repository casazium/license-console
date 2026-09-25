'use client';

import type { ReactNode } from 'react';
import { AppShell, Anchor, Burger, Button, Group, NavLink, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { Branding } from '@/lib/branding';
import type { BackendVersion } from '@/lib/license-client';
import type { AppVersion } from '@/lib/version';
import { BrandLogo } from '@/components/BrandLogo';
import { BrandCopyright } from '@/components/BrandCopyright';
import { VersionStamp } from '@/components/VersionStamp';
import { EmailVerificationBanner } from '@/components/EmailVerificationBanner';
import { VersionCompatibilityBanner } from '@/components/VersionCompatibilityBanner';
import { EnvironmentBanner, ENVIRONMENT_BANNER_HEIGHT } from '@/components/EnvironmentBanner';
import { brandTextButtonStyle } from '@/components/brandButtonStyle';

const BASE_NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/licenses', label: 'Licenses' },
  { href: '/releases', label: 'Releases' },
];

const HEADER_HEIGHT = 60;

export function AppShellClient({
  branding,
  appVersion,
  apiVersion,
  serverIncompatible,
  showBilling,
  showSettingsNav,
  showEmailVerificationBanner,
  environmentLabel,
  children,
}: {
  branding: Branding;
  appVersion: AppVersion;
  apiVersion: BackendVersion;
  // Only ever true on a CONFIRMED version mismatch (see
  // app/(app)/layout.tsx) - an unreachable backend or unparseable
  // version shows no banner, since there's nothing confirmed to warn
  // about.
  serverIncompatible: boolean;
  // SaaS-B4: only true under MULTI_TENANT (see app/(app)/layout.tsx) -
  // self-hosted has no billing concept, so no nav item and no route to
  // reach one.
  showBilling: boolean;
  // Beta-readiness finding: only true under MULTI_TENANT - self-hosted
  // operators already hold their own ADMIN_API_KEY and manage their one
  // shared login via env vars, with nothing on this page for them (see
  // app/(app)/settings/page.tsx).
  showSettingsNav: boolean;
  // Only true under MULTI_TENANT with an unverified account (see
  // app/(app)/layout.tsx) - self-hosted has no email/verification
  // concept at all.
  showEmailVerificationBanner: boolean;
  // Rendered inside AppShell.Header, not as a sibling above <AppShell>
  // (components/AuthShell.tsx's approach for pre-auth pages) - Mantine's
  // AppShell.Header is `position: fixed` to the true viewport top and
  // paints directly over anything placed before it in normal document
  // flow, confirmed live. Embedding it here and growing `header.height`
  // by its exact size instead lets Mantine's own layout math (Main's
  // padding, Navbar's top offset) account for it correctly.
  environmentLabel: string | null;
  children: ReactNode;
}) {
  const navItems = [
    ...BASE_NAV_ITEMS,
    ...(showSettingsNav ? [{ href: '/settings', label: 'Settings' }] : []),
    ...(showBilling ? [{ href: '/billing', label: 'Billing' }] : []),
  ];
  const [opened, { toggle }] = useDisclosure();
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    await fetch('/api/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  // Same treatment as casazium.com's marketing nav (HOMEPAGE-SPEC.md
  // section 2): a flat hairline instead of Mantine's default shadow, no
  // filled background behind the active link - only ink vs ink-3 (see
  // "backgroundColor: transparent" below, which overrides Mantine's own
  // light-variant active fill).
  const shellSurfaceStyle = { backgroundColor: 'var(--cz-paper)', boxShadow: 'none' };

  const totalHeaderHeight = environmentLabel ? HEADER_HEIGHT + ENVIRONMENT_BANNER_HEIGHT : HEADER_HEIGHT;

  return (
    <AppShell
      header={{ height: totalHeaderHeight }}
      navbar={{ width: 220, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      footer={{ height: 36 }}
      padding="md"
      styles={{
        header: { ...shellSurfaceStyle, borderBottom: '1px solid var(--cz-rule)' },
        navbar: { ...shellSurfaceStyle, borderRight: '1px solid var(--cz-rule)' },
        footer: { ...shellSurfaceStyle, borderTop: '1px solid var(--cz-rule)' },
      }}
    >
      <AppShell.Header>
        <EnvironmentBanner label={environmentLabel} />
        <Group h={HEADER_HEIGHT} px="md" justify="space-between">
          <Group gap="xs">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" color="var(--cz-ink)" />
            <BrandLogo logoUrl={branding.logoUrl} linkUrl={branding.logoLinkUrl} size={28} />
          </Group>
          <Button variant="subtle" style={brandTextButtonStyle} onClick={handleSignOut}>
            Sign out
          </Button>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="md">
        {navItems.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <NavLink
              key={item.href}
              component={Link}
              href={item.href}
              label={item.label}
              active={active}
              c={active ? 'var(--cz-ink)' : 'var(--cz-ink-3)'}
              fw={active ? 500 : 400}
              styles={{ root: { backgroundColor: 'transparent' } }}
            />
          );
        })}
      </AppShell.Navbar>
      <AppShell.Main>
        {showEmailVerificationBanner && <EmailVerificationBanner />}
        {serverIncompatible && apiVersion && (
          <VersionCompatibilityBanner serverVersion={apiVersion.version} />
        )}
        {children}
      </AppShell.Main>
      <AppShell.Footer>
        <Group h="100%" px="md" justify="center" gap="xs">
          {branding.copyrightHolder && (
            <>
              <BrandCopyright holder={branding.copyrightHolder} />
              <Text size="xs" c="dimmed">
                &middot;
              </Text>
            </>
          )}
          <VersionStamp {...appVersion} apiVersion={apiVersion} />
          {branding.supportEmail && (
            <>
              <Text size="xs" c="dimmed">
                &middot;
              </Text>
              <Anchor href={`mailto:${branding.supportEmail}`} size="xs" c="dimmed">
                Contact support
              </Anchor>
            </>
          )}
        </Group>
      </AppShell.Footer>
    </AppShell>
  );
}
