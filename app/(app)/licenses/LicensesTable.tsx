'use client';

import { useMemo, useState } from 'react';
import { Anchor, Badge, Group, Stack, Table, Text, UnstyledButton } from '@mantine/core';
import Link from 'next/link';
import type { LicenseListItem } from '@/lib/license-client';
import { formatDate } from '@/lib/format';

type SortColumn = 'key' | 'product_id' | 'tier' | 'status' | 'issued_to' | 'expires_at' | 'seats';
type SortDirection = 'asc' | 'desc';

// Sorts only the currently-loaded page, not the full dataset: the real
// GET /list-licenses has no sort parameter at all (hardcoded
// ORDER BY issued_at DESC), so a true full-dataset sort isn't possible
// without a backend change. See PROJECT_STATUS.md §11.
const COLUMNS: { key: SortColumn; label: string }[] = [
  { key: 'key', label: 'Key' },
  { key: 'product_id', label: 'Product' },
  { key: 'tier', label: 'Tier' },
  { key: 'status', label: 'Status' },
  { key: 'issued_to', label: 'Issued to' },
  { key: 'expires_at', label: 'Expires' },
  { key: 'seats', label: 'Seats' },
];

function sortValue(license: LicenseListItem, column: SortColumn): string | number {
  if (column === 'seats') return license.activations_used;
  // Perpetual (expires_at: null) sorts after every real date - "never
  // expires" is the furthest-out value, not the earliest.
  if (column === 'expires_at') return license.expires_at ?? '9999-12-31T00:00:00.000Z';
  return license[column];
}

export function LicensesTable({
  licenses,
  hasFilters,
}: {
  licenses: LicenseListItem[];
  hasFilters: boolean;
}) {
  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  const sorted = useMemo(() => {
    if (!sortColumn) return licenses;
    const factor = sortDirection === 'asc' ? 1 : -1;
    return [...licenses].sort((a, b) => {
      const aValue = sortValue(a, sortColumn);
      const bValue = sortValue(b, sortColumn);
      if (aValue < bValue) return -1 * factor;
      if (aValue > bValue) return 1 * factor;
      return 0;
    });
  }, [licenses, sortColumn, sortDirection]);

  function toggleSort(column: SortColumn) {
    if (sortColumn === column) {
      setSortDirection((direction) => (direction === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
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
                    {sortColumn === column.key ? (sortDirection === 'asc' ? '↑' : '↓') : '↕'}
                  </Text>
                </Group>
              </UnstyledButton>
            </Table.Th>
          ))}
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {sorted.map((license) => (
          <Table.Tr key={license.key}>
            <Table.Td>
              <Anchor component={Link} href={`/licenses/${license.key}`}>
                {license.key}
              </Anchor>
            </Table.Td>
            <Table.Td>{license.product_id}</Table.Td>
            <Table.Td>{license.tier}</Table.Td>
            <Table.Td>
              <Badge color={license.status === 'active' ? 'green' : 'gray'}>
                {license.status}
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
        ))}
      </Table.Tbody>
    </Table>
  );
}
