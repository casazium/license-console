import { Group, Text, Title } from '@mantine/core';
import { listReleases } from '@/lib/license-client';
import { isRateLimited } from '@/lib/errors';
import { requireSessionWithTenantKey, markIfTenantRejected } from '@/lib/tenant-context';
import { MockDataNotice } from '@/components/MockDataNotice';
import { RateLimitNotice } from '@/components/RateLimitNotice';
import { RegisterReleaseButton } from './RegisterReleaseButton';
import { ReleasesFilters } from './ReleasesFilters';
import { ReleasesPagination } from './ReleasesPagination';
import { ReleasesTable } from './ReleasesTable';

export const dynamic = 'force-dynamic';

// Same page size as LicensesPage - real pagination added (round-3
// independent review, finding C-3): this page used to hardcode
// `offset: 0` with no way to reach a release past the first 50 despite
// telling the tenant "Showing X of Y" whenever more existed.
const PAGE_SIZE = 10;

export default async function ReleasesPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    product_id?: string;
    channel?: string;
    platform?: string;
    status?: string;
  }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const productId = params.product_id?.trim() || undefined;
  const channel = params.channel?.trim() || undefined;
  const platform = params.platform?.trim() || undefined;
  const status = params.status === 'published' || params.status === 'unpublished' ? params.status : undefined;
  const hasFilters = Boolean(productId || channel || platform || status);

  // SaaS-B2: see licenses/page.tsx's matching comment.
  const { identity, tenantApiKey } = await requireSessionWithTenantKey();

  let listResult;
  try {
    listResult = await listReleases(
      {
        product_id: productId,
        channel,
        platform,
        status,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      },
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
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <Group justify="space-between" mb="md">
        <Title order={2}>Releases</Title>
        <RegisterReleaseButton />
      </Group>
      <ReleasesFilters status={status} productId={productId} channel={channel} platform={platform} />
      <ReleasesTable releases={releases} hasFilters={hasFilters} />
      {total > 0 && (
        <Group justify="space-between" mt="md">
          <Text size="sm" c="dimmed">
            Showing {releases.length} of {total}
          </Text>
          <ReleasesPagination page={page} totalPages={totalPages} />
        </Group>
      )}
      <MockDataNotice />
    </>
  );
}
