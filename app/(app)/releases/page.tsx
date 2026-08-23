import { Group, Text, Title } from '@mantine/core';
import { listReleases } from '@/lib/license-client';
import { isRateLimited } from '@/lib/errors';
import { requireSessionWithTenantKey, markIfTenantRejected } from '@/lib/tenant-context';
import { MockDataNotice } from '@/components/MockDataNotice';
import { RateLimitNotice } from '@/components/RateLimitNotice';
import { RegisterReleaseButton } from './RegisterReleaseButton';
import { ReleasesTable } from './ReleasesTable';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

export default async function ReleasesPage({
  searchParams,
}: {
  searchParams: Promise<{
    product_id?: string;
    channel?: string;
    platform?: string;
    status?: string;
  }>;
}) {
  const params = await searchParams;
  const productId = params.product_id?.trim() || undefined;
  const channel = params.channel?.trim() || undefined;
  const platform = params.platform?.trim() || undefined;
  const status = params.status === 'published' || params.status === 'unpublished' ? params.status : undefined;
  const hasFilters = Boolean(productId || channel || platform || status);

  // SaaS-B2: see app/(app)/licenses/page.tsx's matching comment.
  const { identity, tenantApiKey } = await requireSessionWithTenantKey();

  let listResult;
  try {
    listResult = await listReleases(
      { product_id: productId, channel, platform, status, limit: PAGE_SIZE, offset: 0 },
      tenantApiKey
    );
  } catch (err) {
    if (isRateLimited(err)) {
      return (
        <>
          <Group justify="space-between" mb="md">
            <Title order={2}>Releases</Title>
            <RegisterReleaseButton />
          </Group>
          <RateLimitNotice />
        </>
      );
    }
    markIfTenantRejected(err, identity.tenantId);
    throw err;
  }

  const { releases, total } = listResult;

  return (
    <>
      <Group justify="space-between" mb="md">
        <Title order={2}>Releases</Title>
        <RegisterReleaseButton />
      </Group>
      <ReleasesTable releases={releases} hasFilters={hasFilters} />
      {total > 0 && (
        <Text size="sm" c="dimmed" mt="md">
          Showing {releases.length} of {total}
        </Text>
      )}
      <MockDataNotice />
    </>
  );
}
