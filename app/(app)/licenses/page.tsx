import { Group, Text, Title } from '@mantine/core';
import { listLicenses } from '@/lib/license-client';
import type { LicenseSortColumn } from '@/lib/license-types';
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

// Matches list-licenses.js's own SORTABLE_COLUMNS enum exactly - a
// stray/unknown `sort` value in the URL is treated the same as none
// given, rather than round-tripped through to the backend for its own
// schema validation to 400 on (an admin editing the URL by hand, an old
// bookmark, etc. should just fall back to the default sort, not error).
const SORTABLE_COLUMNS: LicenseSortColumn[] = [
  'key',
  'product_id',
  'tier',
  'status',
  'issued_to',
  'expires_at',
  'activations_count',
];

export default async function LicensesPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    status?: string;
    product_id?: string;
    issued_to?: string;
    key?: string;
    sort?: string;
    order?: string;
  }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const status = params.status === 'active' || params.status === 'revoked' ? params.status : undefined;
  const productId = params.product_id?.trim() || undefined;
  const issuedTo = params.issued_to?.trim() || undefined;
  const licenseKey = params.key?.trim() || undefined;
  const sort = SORTABLE_COLUMNS.includes(params.sort as LicenseSortColumn)
    ? (params.sort as LicenseSortColumn)
    : undefined;
  const order = params.order === 'asc' ? 'asc' : 'desc';
  const hasFilters = Boolean(status || productId || issuedTo || licenseKey);

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
        issued_to: issuedTo,
        key: licenseKey,
        sort,
        order,
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
      <LicensesFilters status={status} productId={productId} issuedTo={issuedTo} licenseKey={licenseKey} />
      <LicensesTable licenses={licenses} hasFilters={hasFilters} sort={sort} order={order} />
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
