import { Button, Group, Text, Title } from '@mantine/core';
import Link from 'next/link';
import { listLicenses } from '@/lib/license-client';
import { LicensesTable } from './LicensesTable';

export const dynamic = 'force-dynamic';

export default async function LicensesPage() {
  const licenses = await listLicenses();

  return (
    <>
      <Group justify="space-between" mb="md">
        <Title order={2}>Licenses</Title>
        <Link href="/licenses/new" passHref legacyBehavior>
          <Button component="a">Issue license</Button>
        </Link>
      </Group>
      <LicensesTable licenses={licenses} />
      <Text c="dimmed" size="sm" mt="md">
        Showing mock data (lib/license-client.ts) — not yet wired to the real
        license server.
      </Text>
    </>
  );
}
