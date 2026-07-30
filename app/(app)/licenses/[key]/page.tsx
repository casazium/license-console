import { Badge, Code, Group, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { getLicense, listActivations } from '@/lib/license-client';
import { ActivationsTable, RevokeDeleteActions } from './LicenseActions';

export const dynamic = 'force-dynamic';

export default async function LicenseDetailPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  const [license, activations] = await Promise.all([getLicense(key), listActivations(key)]);

  if (!license) {
    return (
      <Stack>
        <Title order={2}>License not found</Title>
        <Text c="dimmed">No license with key {key} exists in the mock store.</Text>
      </Stack>
    );
  }

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{license.key}</Title>
        <Badge color={license.status === 'active' ? 'green' : 'gray'}>{license.status}</Badge>
      </Group>

      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <Text size="sm">
          <b>Product:</b> {license.product_id}
        </Text>
        <Text size="sm">
          <b>Tier:</b> {license.tier}
        </Text>
        <Text size="sm">
          <b>Issued to:</b> {license.issued_to}
        </Text>
        <Text size="sm">
          <b>Issued at:</b> {new Date(license.issued_at).toLocaleString()}
        </Text>
        <Text size="sm">
          <b>Expires at:</b> {new Date(license.expires_at).toLocaleString()}
        </Text>
        <Text size="sm">
          <b>Max activations:</b> {license.max_activations}
        </Text>
        <Text size="sm">
          <b>Usage:</b>{' '}
          {license.usage_limit === null
            ? license.usage_count
            : `${license.usage_count} / ${license.usage_limit}`}
        </Text>
        {license.revoked_at && (
          <Text size="sm">
            <b>Revoked at:</b> {new Date(license.revoked_at).toLocaleString()}
          </Text>
        )}
      </SimpleGrid>

      <RevokeDeleteActions licenseKey={license.key} status={license.status} />

      <Title order={4} mt="md">
        Activations
      </Title>
      <ActivationsTable licenseKey={license.key} activations={activations} />
      {activations.length === 0 && (
        <Text c="dimmed" size="sm">
          No activations yet.
        </Text>
      )}

      <Title order={4} mt="md">
        Activate this license
      </Title>
      <Text size="sm" c="dimmed">
        From the licensed application, call the license server with this key:
      </Text>
      <Code block>{`POST https://<your-license-server>/v1/activate-license
Content-Type: application/json

{
  "key": "${license.key}",
  "instance_id": "<unique per install/device>"
}`}</Code>

      <Text c="dimmed" size="sm" mt="md">
        Showing mock data (lib/license-client.ts) — not yet wired to the real
        license server.
      </Text>
    </Stack>
  );
}
