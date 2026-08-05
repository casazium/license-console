import { Group, Text, Title } from '@mantine/core';
import { listLicenses } from '@/lib/license-client';
import { isRateLimited } from '@/lib/errors';
import { requireSessionWithTenantKey, markIfTenantRejected } from '@/lib/tenant-context';
import { MockDataNotice } from '@/components/MockDataNotice';
import { RateLimitNotice } from '@/components/RateLimitNotice';
import { IssueLicenseButton } from './IssueLicenseButton';
import { LicensesFilters } from './LicensesFilters';
import { LicensesPagination } from './LicensesPagination';
import { LicensesTable } from './LicensesTable';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 10;

export default async function LicensesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string; product_id?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const status = params.status === 'active' || params.status === 'revoked' ? params.status : undefined;
  const productId = params.product_id?.trim() || undefined;
  const hasFilters = Boolean(status || productId);

  // SaaS-B2: see dashboard/page.tsx's matching comment.
  const { identity, tenantApiKey } = await requireSessionWithTenantKey();

  // See dashboard/page.tsx's matching comment - only a rate-limited
  // admin bucket gets a friendly inline message; any other error still
  // throws unchanged.
  let listResult;
  try {
    listResult = await listLicenses(
      {
        status,
        product_id: productId,
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
            <Title order={2}>Licenses</Title>
            <IssueLicenseButton />
          </Group>
          <RateLimitNotice />
        </>
      );
    }
    // "Trigger 2" - see dashboard/page.tsx's matching comment.
    markIfTenantRejected(err, identity.tenantId);
    throw err;
  }

  const { licenses, total } = listResult;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <Group justify="space-between" mb="md">
        <Title order={2}>Licenses</Title>
        <IssueLicenseButton />
      </Group>
      <LicensesFilters status={status} productId={productId} />
      <LicensesTable licenses={licenses} hasFilters={hasFilters} />
      {total > 0 && (
        <Group justify="space-between" mt="md">
          <Text size="sm" c="dimmed">
            Showing {licenses.length} of {total}
          </Text>
          <LicensesPagination page={page} totalPages={totalPages} />
        </Group>
      )}
      <MockDataNotice />
    </>
  );
}
