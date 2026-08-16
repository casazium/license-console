import { Anchor, Badge, Code, Group, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { getLicense, listActivations } from '@/lib/license-client';
import { formatDateTime } from '@/lib/format';
import { isRateLimited } from '@/lib/errors';
import { requireSessionWithTenantKey, markIfTenantRejected } from '@/lib/tenant-context';
import { MockDataNotice } from '@/components/MockDataNotice';
import { RateLimitNotice } from '@/components/RateLimitNotice';
import { ActivationsTable, EditTermsButton, NotesEditor, RevokeDeleteActions } from './LicenseActions';

export const dynamic = 'force-dynamic';

export default async function LicenseDetailPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;

  // SaaS-B2: see dashboard/page.tsx's matching comment.
  const { identity, tenantApiKey } = await requireSessionWithTenantKey();

  // Beta-readiness finding: this used to be a literal, un-fillable
  // "<your-license-server>" placeholder for every tenant, hosted or
  // self-hosted. Self-hosted operators know their own deployment's URL;
  // hosted tenants have no other way to learn it - LICENSE_API_URL is
  // this console's own already-public Coolify Domain for the backend
  // (see app/(app)/settings/page.tsx), so it's safe to show directly.
  const apiBaseUrl = tenantApiKey
    ? (process.env.LICENSE_API_URL ?? '').replace(/\/+$/, '')
    : '<your-license-server>/v1';

  // See dashboard/page.tsx's matching comment - only a rate-limited
  // admin bucket gets a friendly inline message; any other error still
  // throws unchanged.
  let license, activations;
  try {
    [license, activations] = await Promise.all([
      getLicense(key, tenantApiKey),
      listActivations(key, tenantApiKey),
    ]);
  } catch (err) {
    if (isRateLimited(err)) {
      return (
        <Stack>
          <Title order={2}>{key}</Title>
          <RateLimitNotice />
        </Stack>
      );
    }
    // "Trigger 2" - see dashboard/page.tsx's matching comment.
    markIfTenantRejected(err, identity.tenantId);
    throw err;
  }

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
          <b>Issued at:</b> {formatDateTime(license.issued_at)}
        </Text>
        <Text size="sm">
          <b>Expires at:</b> {formatDateTime(license.expires_at)}
        </Text>
        <Group gap={6}>
          <Text size="sm" fw={700}>
            Seats:
          </Text>
          {license.max_activations === null ? (
            <Badge color="gray" variant="light">
              {activations.length} / Unlimited
            </Badge>
          ) : (
            <Badge
              color={
                activations.length >= license.max_activations
                  ? 'red'
                  : license.max_activations - activations.length <= 1
                    ? 'yellow'
                    : 'gray'
              }
              variant="light"
            >
              {activations.length} / {license.max_activations}
            </Badge>
          )}
        </Group>
        <Text size="sm">
          <b>Usage:</b>{' '}
          {Object.keys(license.limits).filter((k) => k !== 'features').length === 0 ? (
            'No usage limits set'
          ) : (
            <>
              {Object.entries(license.limits)
                .filter(([metric]) => metric !== 'features')
                .map(([metric, limit]) => `${metric}: ${license.usage[metric] ?? 0} / ${limit}`)
                .join(', ')}
            </>
          )}
        </Text>
        {license.revoked_at && (
          <Text size="sm">
            <b>Revoked at:</b> {formatDateTime(license.revoked_at)}
          </Text>
        )}
      </SimpleGrid>

      <NotesEditor licenseKey={license.key} notes={license.notes} />

      <EditTermsButton
        licenseKey={license.key}
        expiresAt={license.expires_at}
        maxActivations={license.max_activations}
        limits={license.limits}
      />

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
      <Code block>{`POST ${apiBaseUrl}/activate-license
Content-Type: application/json

{
  "key": "${license.key}",
  "instance_id": "<unique per install/device>"
}`}</Code>
      {tenantApiKey && (
        <Text size="xs" c="dimmed">
          This call is unauthenticated (public endpoint) - only the license key above is needed.
          See <Anchor href="/settings">API access</Anchor> for your account&apos;s own API key,
          used for admin operations.
        </Text>
      )}

      <MockDataNotice />
    </Stack>
  );
}
