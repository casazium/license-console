import { Badge, Group, Stack, Text, Title } from '@mantine/core';

export default async function LicenseDetailPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{key}</Title>
        <Badge color="gray">status unknown</Badge>
      </Group>
      <Text c="dimmed" size="sm">
        Wired to GET /export-license/:key, POST /revoke-license, DELETE
        /delete-license, GET /list-activations/:key, and an activation code
        snippet once the license server client is implemented.
      </Text>
    </Stack>
  );
}
