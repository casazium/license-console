'use client';

import { Table } from '@mantine/core';
import type { RecentActivation } from '@/lib/license-client';

export function RecentActivationsTable({
  recentActivations,
}: {
  recentActivations: RecentActivation[];
}) {
  return (
    <Table>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>License key</Table.Th>
          <Table.Th>Instance</Table.Th>
          <Table.Th>Activated at</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {recentActivations.map((activation) => (
          <Table.Tr key={`${activation.key}-${activation.instance_id}`}>
            <Table.Td>{activation.key}</Table.Td>
            <Table.Td>{activation.instance_id}</Table.Td>
            <Table.Td>{new Date(activation.activated_at).toLocaleString()}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}
