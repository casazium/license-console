'use client';

import { Anchor, Badge, Group, Stack, Table, Text, UnstyledButton } from '@mantine/core';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { LicenseSortColumn } from '@/lib/license-types';
import type { LicenseListItem } from '@/lib/license-client';
import { formatDate, licenseStatusBadge } from '@/lib/format';

type SortDirection = 'asc' | 'desc';

// Server-side sort (BETA_LAUNCH_STATUS.md §4): this table used to sort
// only the currently-loaded page client-side, since GET /list-licenses
// had no sort parameter at all. It's now purely a display + URL-param
// control, like LicensesFilters - `licenses` arrives already sorted by
// the server, and clicking a header just navigates with new sort/order
// params rather than reordering anything locally. `activations_count`
// (not `activations_used`, this row's own display field) is the wire
// name - it's the real backend's correlated-subquery SELECT alias.
const COLUMNS: { key: LicenseSortColumn; label: string }[] = [
  { key: 'key', label: 'Key' },
  { key: 'product_id', label: 'Product' },
  { key: 'tier', label: 'Tier' },
  { key: 'status', label: 'Status' },
  { key: 'issued_to', label: 'Issued to' },
  { key: 'expires_at', label: 'Expires' },
  { key: 'activations_count', label: 'Seats' },
];

export function LicensesTable({
  licenses,
  hasFilters,
  sort,
  order,
}: {
  licenses: LicenseListItem[];
  hasFilters: boolean;
  sort?: LicenseSortColumn;
  order: SortDirection;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function toggleSort(column: LicenseSortColumn) {
    const next = new URLSearchParams(searchParams.toString());
    next.set('sort', column);
    next.set('order', sort === column && order === 'asc' ? 'desc' : 'asc');
    next.delete('page'); // changing sort invalidates the current page
    router.push(`${pathname}?${next.toString()}`);
  }

  if (licenses.length === 0) {
    return (
      <Stack align="center" gap="xs" py="xl">
        <Text c="dimmed">
          {hasFilters ? 'No licenses match these filters.' : 'No licenses yet.'}
        </Text>
        {!hasFilters && (
          <Anchor component={Link} href="/licenses/new">
            Issue your first license
          </Anchor>
        )}
      </Stack>
    );
  }

  return (
    <Table>
      <Table.Thead>
        <Table.Tr>
          {COLUMNS.map((column) => (
            <Table.Th key={column.key}>
              <UnstyledButton onClick={() => toggleSort(column.key)}>
                <Group gap={4} wrap="nowrap">
                  {column.label}
                  <Text component="span" size="xs" c="dimmed">
                    {sort === column.key ? (order === 'asc' ? '↑' : '↓') : '↕'}
                  </Text>
                </Group>
              </UnstyledButton>
            </Table.Th>
          ))}
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {licenses.map((license) => {
          const statusBadge = licenseStatusBadge(license.status, license.expires_at);
          return (
          <Table.Tr key={license.key}>
            <Table.Td>
              <Anchor component={Link} href={`/licenses/${license.key}`}>
                {license.key}
              </Anchor>
            </Table.Td>
            <Table.Td>{license.product_id}</Table.Td>
            <Table.Td>{license.tier}</Table.Td>
            <Table.Td>
              <Badge color={statusBadge.color}>
                {statusBadge.label}
              </Badge>
            </Table.Td>
            <Table.Td>{license.issued_to}</Table.Td>
            <Table.Td>{formatDate(license.expires_at)}</Table.Td>
            <Table.Td>
              {license.max_activations === null ? (
                <Badge color="gray" variant="light">
                  {license.activations_used} / Unlimited
                </Badge>
              ) : (
                <Badge
                  color={
                    license.activations_used >= license.max_activations
                      ? 'red'
                      : license.max_activations - license.activations_used <= 1
                        ? 'yellow'
                        : 'gray'
                  }
                  variant="light"
                >
                  {license.activations_used} / {license.max_activations}
                </Badge>
              )}
            </Table.Td>
          </Table.Tr>
          );
        })}
      </Table.Tbody>
    </Table>
  );
}
