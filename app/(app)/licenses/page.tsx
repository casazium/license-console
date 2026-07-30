'use client';

import { Button, Group, Table, Text, Title } from '@mantine/core';
import Link from 'next/link';

export default function LicensesPage() {
  return (
    <>
      <Group justify="space-between" mb="md">
        <Title order={2}>Licenses</Title>
        <Button component={Link} href="/licenses/new">
          Issue license
        </Button>
      </Group>
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
        <Table.Tbody />
      </Table>
      <Text c="dimmed" size="sm" mt="md">
        Wired to GET /list-licenses once the license server client is
        implemented.
      </Text>
    </>
  );
}
