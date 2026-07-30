import { Card, SimpleGrid, Text, Title } from '@mantine/core';
import { getDashboardStats, getRecentActivations } from '@/lib/license-client';
import { RecentActivationsTable } from './RecentActivationsTable';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const [stats, recentActivations] = await Promise.all([
    getDashboardStats(),
    getRecentActivations(),
  ]);

  return (
    <>
      <Title order={2} mb="md">
        Dashboard
      </Title>
      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        <Card withBorder padding="lg">
          <Text size="sm" c="dimmed">
            Active licenses
          </Text>
          <Title order={3}>{stats.active_licenses}</Title>
        </Card>
        <Card withBorder padding="lg">
          <Text size="sm" c="dimmed">
            Active activations
          </Text>
          <Title order={3}>{stats.active_activations}</Title>
        </Card>
        <Card withBorder padding="lg">
          <Text size="sm" c="dimmed">
            Revoked licenses
          </Text>
          <Title order={3}>{stats.revoked_licenses}</Title>
        </Card>
      </SimpleGrid>

      <Title order={4} mt="xl" mb="sm">
        Recent activations
      </Title>
      <RecentActivationsTable recentActivations={recentActivations} />

      <Text c="dimmed" size="sm" mt="xl">
        Showing mock data (lib/license-client.ts) — not yet wired to the real
        license server.
      </Text>
    </>
  );
}
