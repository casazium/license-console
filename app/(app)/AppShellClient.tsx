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
];

export function AppShellClient({
  branding,
  appVersion,
  showBilling,
  showApiSettings,
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
  // operators already hold their own ADMIN_API_KEY and have no per-tenant
  // key to view (see app/(app)/settings/page.tsx).
  showApiSettings: boolean;
  // Only true under MULTI_TENANT with an unverified account (see
  // app/(app)/layout.tsx) - self-hosted has no email/verification
  // concept at all.
  showEmailVerificationBanner: boolean;
  children: ReactNode;
}) {
  const navItems = [
    ...BASE_NAV_ITEMS,
    ...(showApiSettings ? [{ href: '/settings', label: 'API access' }] : []),
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

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: 220, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      footer={{ height: 36 }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="xs">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <BrandLogo logoUrl={branding.logoUrl} linkUrl={branding.logoLinkUrl} size={28} />
          </Group>
          <Button variant="subtle" style={brandTextButtonStyle} onClick={handleSignOut}>
            Sign out
          </Button>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="md">
        {navItems.map((item) => (
          <NavLink
            key={item.href}
            component={Link}
            href={item.href}
            label={item.label}
            active={pathname.startsWith(item.href)}
          />
        ))}
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
