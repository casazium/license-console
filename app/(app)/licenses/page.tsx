import { Group, Text, Title } from '@mantine/core';
import { listLicenses } from '@/lib/license-client';
import { IssueLicenseButton } from './IssueLicenseButton';
import { LicensesTable } from './LicensesTable';

export const dynamic = 'force-dynamic';

export default async function LicensesPage() {
  const licenses = await listLicenses();

  return (
    <>
      <Group justify="space-between" mb="md">
        <Title order={2}>Licenses</Title>
        <IssueLicenseButton />
      </Group>
      <LicensesTable licenses={licenses} />
      <Text c="dimmed" size="sm" mt="md">
        Showing mock data (lib/license-client.ts) — not yet wired to the real
        license server.
      </Text>
    </>
  );
}
