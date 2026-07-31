'use client';

import { Anchor, Badge, Table, Text } from '@mantine/core';
import Link from 'next/link';
import type { SeatUtilization } from '@/lib/license-client';

export function SeatUtilizationTable({ licenses }: { licenses: SeatUtilization[] }) {
  if (licenses.length === 0) {
    // Good news, same reasoning as ExpiringLicensesTable - no action needed.
    return (
      <Text c="dimmed" py="md">
        No licenses near their seat limit.
      </Text>
    );
  }

  return (
    <Table>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Key</Table.Th>
          <Table.Th>Product</Table.Th>
          <Table.Th>Tier</Table.Th>
          <Table.Th>Seats used</Table.Th>
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
              <Badge color={license.remaining === 0 ? 'red' : 'yellow'} variant="light">
                {license.used} / {license.max_activations}
              </Badge>
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}
