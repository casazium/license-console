'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Anchor, Badge, Button, Group, Modal, Stack, Table, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import Link from 'next/link';
import type { Release } from '@/lib/license-client';
import { formatDateTime } from '@/lib/format';
import { unpublishReleaseAction } from './actions';
import { notifyRateLimited } from '@/lib/notify';

// Per-row confirm-modal for Unpublish, mirroring the danger-zone pattern
// in app/(app)/settings/RotateApiKeySection.tsx (useDisclosure + an
// <Alert> naming the actual consequence before confirming) - unpublishing
// is disruptive to live end-user traffic (their apps stop seeing this
// version as an update), not a bare toggle that deserves no confirmation.
function UnpublishButton({ release }: { release: Release }) {
  const router = useRouter();
  const [opened, { open, close }] = useDisclosure(false);
  const [busy, setBusy] = useState(false);

  async function handleConfirm() {
    setBusy(true);
    try {
      const result = await unpublishReleaseAction(release.id);
      if (!result.ok) {
        notifyRateLimited();
        setBusy(false);
        return;
      }
      notifications.show({
        color: 'green',
        title: 'Release unpublished',
        message: `${release.product_id} ${release.version} (${release.channel}/${release.platform})`,
      });
      close();
      router.refresh();
    } catch {
      notifications.show({
        color: 'red',
        title: 'Failed to unpublish release',
        message: 'Something went wrong. Please try again.',
      });
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="xs" color="yellow.8" variant="outline" onClick={open}>
        Unpublish
      </Button>
      <Modal opened={opened} onClose={close} title="Unpublish release" centered>
        <Stack>
          <Alert color="yellow" variant="light" title="Takes effect immediately">
            End-user apps on the <strong>{release.channel}</strong> channel for{' '}
            <strong>{release.platform}</strong> will stop seeing{' '}
            <strong>{release.version}</strong> as an update as soon as you confirm. This can be
            reversed only by registering a new release - the row itself is kept, not deleted.
          </Alert>
          <Group justify="flex-end">
            <Button variant="default" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button color="yellow.8" onClick={handleConfirm} loading={busy}>
              Unpublish
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

export function ReleasesTable({ releases, hasFilters }: { releases: Release[]; hasFilters: boolean }) {
  if (releases.length === 0) {
    return (
      <Stack align="center" gap="xs" py="xl">
        <Text c="dimmed">
          {hasFilters ? 'No releases match these filters.' : 'No releases registered yet.'}
        </Text>
        {!hasFilters && (
          <Anchor component={Link} href="/releases/new">
            Register your first release
          </Anchor>
        )}
      </Stack>
    );
  }

  return (
    <Table>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Product</Table.Th>
          <Table.Th>Version</Table.Th>
          <Table.Th>Channel</Table.Th>
          <Table.Th>Platform</Table.Th>
          <Table.Th>Status</Table.Th>
          <Table.Th>Registered</Table.Th>
          <Table.Th />
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {releases.map((release) => (
          <Table.Tr key={release.id}>
            <Table.Td>{release.product_id}</Table.Td>
            <Table.Td>{release.version}</Table.Td>
            <Table.Td>{release.channel}</Table.Td>
            <Table.Td>{release.platform}</Table.Td>
            <Table.Td>
              <Badge color={release.status === 'published' ? 'green' : 'gray'}>
                {release.status}
              </Badge>
            </Table.Td>
            <Table.Td>{formatDateTime(release.created_at)}</Table.Td>
            <Table.Td>
              {release.status === 'published' && <UnpublishButton release={release} />}
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}
