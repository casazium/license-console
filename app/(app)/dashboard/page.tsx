import { Card, SimpleGrid, Text, Title } from '@mantine/core';

export default function DashboardPage() {
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
          <Title order={3}>—</Title>
        </Card>
        <Card withBorder padding="lg">
          <Text size="sm" c="dimmed">
            Active activations
          </Text>
          <Title order={3}>—</Title>
        </Card>
        <Card withBorder padding="lg">
          <Text size="sm" c="dimmed">
            Revoked licenses
          </Text>
          <Title order={3}>—</Title>
        </Card>
      </SimpleGrid>
      <Text c="dimmed" size="sm" mt="xl">
        Wired to GET /admin/stats and GET /recent-activations once the license
        server client is implemented.
      </Text>
    </>
  );
}
