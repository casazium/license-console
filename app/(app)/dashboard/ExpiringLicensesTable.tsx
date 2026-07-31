'use client';

import { Anchor, Table, Text } from '@mantine/core';
import Link from 'next/link';
import type { ExpiringLicense } from '@/lib/license-client';

export function ExpiringLicensesTable({ licenses }: { licenses: ExpiringLicense[] }) {
  if (licenses.length === 0) {
    // Empty here is good news, not an error state - unlike "no licenses
    // yet" elsewhere, there's nothing to do about an empty expiring-soon
    // list, so no call-to-action.
    return (
      <Text c="dimmed" py="md">
        Nothing expiring in the next 30 days.
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
            <Table.Td>{license.issued_to}</Table.Td>
            <Table.Td>{new Date(license.expires_at).toLocaleDateString()}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}
