'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Group, Table } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import type { Activation } from '@/lib/license-client';
import {
  deleteLicenseAction,
  reissueActivationTokenAction,
  setLicenseRevokedAction,
} from '../actions';

export function RevokeDeleteActions({
  licenseKey,
  status,
}: {
  licenseKey: string;
  status: 'active' | 'revoked';
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleToggleRevoke() {
    setBusy(true);
    await setLicenseRevokedAction(licenseKey, status === 'active');
    notifications.show({
      color: status === 'active' ? 'orange' : 'green',
      title: status === 'active' ? 'License revoked' : 'License unrevoked',
      message: licenseKey,
    });
    router.refresh();
    setBusy(false);
  }

  async function handleDelete() {
    if (!window.confirm(`Permanently delete ${licenseKey}? This cannot be undone.`)) {
      return;
    }
    setBusy(true);
    await deleteLicenseAction(licenseKey);
    notifications.show({ color: 'red', title: 'License deleted', message: licenseKey });
    router.push('/licenses');
  }

  return (
    <Group>
      <Button variant="default" loading={busy} onClick={handleToggleRevoke}>
        {status === 'active' ? 'Revoke' : 'Unrevoke'}
      </Button>
      <Button color="red" variant="outline" loading={busy} onClick={handleDelete}>
        Delete
      </Button>
    </Group>
  );
}

export function ActivationsTable({
  licenseKey,
  activations,
}: {
  licenseKey: string;
  activations: Activation[];
}) {
  const [busyInstance, setBusyInstance] = useState<string | null>(null);

  async function handleReissue(instanceId: string) {
    setBusyInstance(instanceId);
    const result = await reissueActivationTokenAction(licenseKey, instanceId);
    setBusyInstance(null);
    if (!result) {
      notifications.show({ color: 'red', title: 'Reissue failed', message: instanceId });
      return;
    }
    notifications.show({
      color: 'blue',
      title: 'Token reissued',
      message: result.token,
      autoClose: false,
    });
  }

  if (activations.length === 0) {
    return null;
  }

  return (
    <Table>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Instance</Table.Th>
          <Table.Th>Activated at</Table.Th>
          <Table.Th />
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {activations.map((activation) => (
          <Table.Tr key={activation.instance_id}>
            <Table.Td>{activation.instance_id}</Table.Td>
            <Table.Td>{new Date(activation.activated_at).toLocaleString()}</Table.Td>
            <Table.Td>
              <Button
                size="xs"
                variant="subtle"
                loading={busyInstance === activation.instance_id}
                onClick={() => handleReissue(activation.instance_id)}
              >
                Reissue token
              </Button>
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}
