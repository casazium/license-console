'use client';

import { Anchor, Stack, Table, Text } from '@mantine/core';
import Link from 'next/link';
import type { RecentlyIssuedLicense } from '@/lib/license-client';
import { formatDate } from '@/lib/format';

export function RecentlyIssuedLicensesTable({ licenses }: { licenses: RecentlyIssuedLicense[] }) {
  if (licenses.length === 0) {
    // Only happens when there are zero licenses at all - same actionable
    // empty state as the main licenses page.
    return (
      <Stack align="center" gap="xs" py="xl">
        <Text c="dimmed">No licenses issued yet.</Text>
        <Anchor component={Link} href="/licenses/new">
          Issue your first license
        </Anchor>
      </Stack>
    );
  }

  return (
    <Table>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Key</Table.Th>
          <Table.Th>Product</Table.Th>
          <Table.Th>Tier</Table.Th>
          <Table.Th>Issued to</Table.Th>
          <Table.Th>Issued at</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {licenses.map((license) => (
          <Table.Tr key={license.key}>
            <Table.Td>
              <Anchor component={Link} href={`/licenses/${license.key}`}>
                {license.key}
              </Anchor>
            </Table.Td>
            <Table.Td>{license.product_id}</Table.Td>
            <Table.Td>{license.tier}</Table.Td>
            <Table.Td>{license.issued_to}</Table.Td>
            <Table.Td>{formatDate(license.issued_at)}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}
