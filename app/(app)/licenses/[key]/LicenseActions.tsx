'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Group, Modal, Stack, Table, Text, Textarea } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import type { Activation } from '@/lib/license-client';
import { formatDateTime } from '@/lib/format';
import { notifyRateLimited } from '@/lib/notify';
import { brandButtonStyle, brandTextButtonStyle } from '@/components/brandButtonStyle';
import {
  deleteLicenseAction,
  reissueActivationTokenAction,
  setLicenseRevokedAction,
  updateLicenseNotesAction,
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
  const [deleteModalOpened, { open: openDeleteModal, close: closeDeleteModal }] =
    useDisclosure(false);

  async function handleToggleRevoke() {
    setBusy(true);
    try {
      const result = await setLicenseRevokedAction(licenseKey, status === 'active');
      if (!result.ok) {
        notifyRateLimited();
        return;
      }
      notifications.show({
        color: status === 'active' ? 'orange' : 'green',
        title: status === 'active' ? 'License revoked' : 'License unrevoked',
        message: licenseKey,
      });
      router.refresh();
    } catch {
      notifications.show({
        color: 'red',
        title: status === 'active' ? 'Failed to revoke license' : 'Failed to unrevoke license',
        message: 'Something went wrong. Please try again.',
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    closeDeleteModal();
    setBusy(true);
    try {
      const result = await deleteLicenseAction(licenseKey);
      if (!result.ok) {
        notifyRateLimited();
        setBusy(false);
        return;
      }
      notifications.show({ color: 'red', title: 'License deleted', message: licenseKey });
      router.push('/licenses');
    } catch {
      notifications.show({
        color: 'red',
        title: 'Failed to delete license',
        message: 'Something went wrong. Please try again.',
      });
      setBusy(false);
    }
  }

  return (
    <>
      <Group>
        <Button variant="default" loading={busy} onClick={handleToggleRevoke}>
          {status === 'active' ? 'Revoke' : 'Unrevoke'}
        </Button>
        <Button color="red" variant="outline" loading={busy} onClick={openDeleteModal}>
          Delete
        </Button>
      </Group>

      <Modal opened={deleteModalOpened} onClose={closeDeleteModal} title="Delete license" centered>
        <Text size="sm">
          Permanently delete <b>{licenseKey}</b>? This cannot be undone.
        </Text>
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={closeDeleteModal}>
            Cancel
          </Button>
          <Button color="red" onClick={handleDelete}>
            Delete
          </Button>
        </Group>
      </Modal>
    </>
  );
}

export function NotesEditor({
  licenseKey,
  notes: initialNotes,
}: {
  licenseKey: string;
  notes: string | null;
}) {
  const [notes, setNotes] = useState(initialNotes);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialNotes ?? '');
  const [saving, setSaving] = useState(false);

  function handleCancel() {
    setDraft(notes ?? '');
    setEditing(false);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const result = await updateLicenseNotesAction(licenseKey, draft);
      if (!result.ok) {
        notifyRateLimited();
        return;
      }
      setNotes(draft || null);
      setEditing(false);
      notifications.show({ color: 'green', title: 'Notes saved', message: licenseKey });
    } catch {
      notifications.show({
        color: 'red',
        title: 'Failed to save notes',
        message: 'Something went wrong. Please try again.',
      });
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <Stack gap={4}>
        <Text size="sm" fw={700}>
          Notes
        </Text>
        <Textarea
          autosize
          minRows={2}
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
        />
        <Group gap="xs">
          <Button size="xs" loading={saving} onClick={handleSave} style={brandButtonStyle}>
            Save
          </Button>
          <Button size="xs" variant="default" disabled={saving} onClick={handleCancel}>
            Cancel
          </Button>
        </Group>
      </Stack>
    );
  }

  return (
    <Stack gap={4}>
      <Group justify="space-between">
        <Text size="sm" fw={700}>
          Notes
        </Text>
        <Button
          size="xs"
          variant="subtle"
          style={brandTextButtonStyle}
          onClick={() => setEditing(true)}
        >
          {notes ? 'Edit' : 'Add note'}
        </Button>
      </Group>
      <Text size="sm" c={notes ? undefined : 'dimmed'} style={{ whiteSpace: 'pre-wrap' }}>
        {notes || 'No notes yet.'}
      </Text>
    </Stack>
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
    try {
      const result = await reissueActivationTokenAction(licenseKey, instanceId);
      if (!result.ok) {
        notifyRateLimited();
        return;
      }
      if (!result.data) {
        notifications.show({ color: 'red', title: 'Reissue failed', message: instanceId });
        return;
      }
      notifications.show({
        color: 'blue',
        title: 'Token reissued',
        message: result.data.token,
        autoClose: false,
      });
    } catch {
      notifications.show({
        color: 'red',
        title: 'Reissue failed',
        message: 'Something went wrong. Please try again.',
      });
    } finally {
      setBusyInstance(null);
    }
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
            <Table.Td>{formatDateTime(activation.activated_at)}</Table.Td>
            <Table.Td>
              <Button
                size="xs"
                variant="subtle"
                style={brandTextButtonStyle}
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
