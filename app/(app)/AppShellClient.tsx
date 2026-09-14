'use client';

import type { ReactNode } from 'react';
import { AppShell, Anchor, Burger, Button, Group, NavLink, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { Branding } from '@/lib/branding';
import type { AppVersion } from '@/lib/version';
import { BrandLogo } from '@/components/BrandLogo';
import { BrandCopyright } from '@/components/BrandCopyright';
import { VersionStamp } from '@/components/VersionStamp';
import { EmailVerificationBanner } from '@/components/EmailVerificationBanner';
import { brandTextButtonStyle } from '@/components/brandButtonStyle';

const BASE_NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/licenses', label: 'Licenses' },
  { href: '/releases', label: 'Releases' },
];

export function AppShellClient({
  branding,
  appVersion,
  showBilling,
  showSettingsNav,
  showEmailVerificationBanner,
  children,
}: {
  branding: Branding;
  appVersion: AppVersion;
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

  return (
    <AppShell
      header={{ height: 60 }}
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
        <Group h="100%" px="md" justify="space-between">
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
          <VersionStamp {...appVersion} />
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
