'use client';

import { Anchor, Badge, Stack, Table, Text } from '@mantine/core';
import Link from 'next/link';
import type { License } from '@/lib/license-client';

export function LicensesTable({ licenses }: { licenses: License[] }) {
  if (licenses.length === 0) {
    return (
      <Stack align="center" gap="xs" py="xl">
        <Text c="dimmed">No licenses yet.</Text>
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
          <Table.Th>Status</Table.Th>
          <Table.Th>Issued to</Table.Th>
          <Table.Th>Expires</Table.Th>
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
            <Table.Td>
              <Badge color={license.status === 'active' ? 'green' : 'gray'}>
                {license.status}
              </Badge>
            </Table.Td>
            <Table.Td>{license.issued_to}</Table.Td>
            <Table.Td>{new Date(license.expires_at).toLocaleDateString()}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}
