import { Anchor, Badge, Code, Group, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { getRelease } from '@/lib/license-client';
import { formatDateTime } from '@/lib/format';
import { isRateLimited } from '@/lib/errors';
import { requireSessionWithTenantKey, markIfTenantRejected } from '@/lib/tenant-context';
import { MockDataNotice } from '@/components/MockDataNotice';
import { RateLimitNotice } from '@/components/RateLimitNotice';
import { UnpublishButton } from '../ReleasesTable';
import { CopyUrlButton } from '../CopyUrlButton';

export const dynamic = 'force-dynamic';

// Round-3 independent review, console finding C-2: the Releases UI could
// list releases but had no way to see (or verify) artifact_url/checksum/
// release_notes/signature after registering one - the two fields that
// actually determine what a tenant's own customers download, with no way
// back to check them. Mirrors app/(app)/licenses/[key]/page.tsx's own
// shape (Server Component, requireSessionWithTenantKey, a not-found
// fallback, a danger-zone action reused from the list view).
//
// Plain `href` strings on every Anchor here, not `component={Link}`
// (caught live during verification, not by lint/typecheck): a Server
// Component can't pass a function - `Link` itself, or CopyButton's own
// render-prop children (now isolated into CopyUrlButton.tsx, a real
// 'use client' component) - across the boundary into a Client Component
// prop. A plain string href still navigates correctly, just as a full
// page load rather than client-side routing - the same tradeoff
// app/(app)/licenses/[key]/page.tsx's own `<Anchor href="/settings">`
// already makes for the same reason.
export default async function ReleaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: idParam } = await params;
  const id = Number(idParam);

  const { identity, tenantApiKey } = await requireSessionWithTenantKey();

  if (!Number.isInteger(id)) {
    return (
      <Stack>
        <Title order={2}>Release not found</Title>
        <Text c="dimmed">&quot;{idParam}&quot; is not a valid release id.</Text>
      </Stack>
    );
  }

  let release;
  try {
    release = await getRelease(id, tenantApiKey);
  } catch (err) {
    if (isRateLimited(err)) {
      return (
        <Stack>
          <Title order={2}>Release {idParam}</Title>
          <RateLimitNotice />
        </Stack>
      );
    }
    markIfTenantRejected(err, identity.tenantId);
    throw err;
  }

  if (!release) {
    return (
      <Stack>
        <Title order={2}>Release not found</Title>
        <Text c="dimmed">No release with id {idParam} exists.</Text>
        <Anchor href="/releases">Back to Releases</Anchor>
      </Stack>
    );
  }

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>
          {release.product_id} {release.version}
        </Title>
        <Badge color={release.status === 'published' ? 'green' : 'gray'}>{release.status}</Badge>
      </Group>

      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <Text size="sm">
          <b>Channel:</b> {release.channel}
        </Text>
        <Text size="sm">
          <b>Platform:</b> {release.platform}
        </Text>
        <Text size="sm">
          <b>Registered:</b> {formatDateTime(release.created_at)}
        </Text>
        <Text size="sm">
          <b>Checksum:</b> <Code>{release.checksum}</Code>
        </Text>
      </SimpleGrid>

      <div>
        <Text size="sm" fw={700} mb={4}>
          Artifact URL
        </Text>
        <Group gap="xs" wrap="nowrap">
          <Code block style={{ flex: 1, wordBreak: 'break-all' }}>
            {release.artifact_url}
          </Code>
          <CopyUrlButton value={release.artifact_url} />
        </Group>
        <Text size="xs" c="dimmed" mt={4}>
          A URL you already host - License Server never stores or proxies this file itself.
        </Text>
      </div>

      {release.release_notes && (
        <div>
          <Text size="sm" fw={700} mb={4}>
            Release notes
          </Text>
          <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
            {release.release_notes}
          </Text>
        </div>
      )}

      <div>
        <Text size="sm" fw={700} mb={4}>
          Signature
        </Text>
        <Code block style={{ wordBreak: 'break-all' }}>
          {release.signature}
        </Code>
        <Text size="xs" c="dimmed" mt={4}>
          RSA/SHA256 over this release&apos;s data, computed once at registration. Verify it
          against <Code>GET /public-key</Code> the same way an offline license file is verified -
          see the API reference for the exact field order this covers.
        </Text>
      </div>

      {release.status === 'published' && (
        <Group>
          <UnpublishButton release={release} />
        </Group>
      )}

      <Anchor href="/releases" size="sm">
        Back to Releases
      </Anchor>

      <MockDataNotice />
    </Stack>
  );
}
