'use client';

import type { ReactNode } from 'react';
import { AppShell, Burger, Button, Group, NavLink } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { Branding } from '@/lib/branding';
import { BrandLogo } from '@/components/BrandLogo';
import { BrandCopyright } from '@/components/BrandCopyright';
import { brandTextButtonStyle } from '@/components/brandButtonStyle';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/licenses', label: 'Licenses' },
];

export function AppShellClient({ branding, children }: { branding: Branding; children: ReactNode }) {
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
      footer={branding.copyrightHolder ? { height: 36 } : undefined}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="xs">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <BrandLogo logoUrl={branding.logoUrl} size={28} />
          </Group>
          <Button variant="subtle" style={brandTextButtonStyle} onClick={handleSignOut}>
            Sign out
          </Button>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="md">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.href}
            component={Link}
            href={item.href}
            label={item.label}
            active={pathname.startsWith(item.href)}
          />
        ))}
      </AppShell.Navbar>
      <AppShell.Main>{children}</AppShell.Main>
      {branding.copyrightHolder && (
        <AppShell.Footer>
          <Group h="100%" px="md" justify="center">
            <BrandCopyright holder={branding.copyrightHolder} />
          </Group>
        </AppShell.Footer>
      )}
    </AppShell>
  );
}
