'use client';

import type { ReactNode } from 'react';
import { AppShell, Burger, Button, Group, NavLink, Title } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/licenses', label: 'Licenses' },
];

export default function AppLayout({ children }: { children: ReactNode }) {
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
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group>
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Title order={4}>License Console</Title>
          </Group>
          <Button variant="subtle" onClick={handleSignOut}>
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
    </AppShell>
  );
}
