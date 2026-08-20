'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Checkbox, Group, Modal, NumberInput, Select, Stack, Table, Text, Textarea } from '@mantine/core';
import { DateInput, TimeInput } from '@mantine/dates';
import { useDisclosure } from '@mantine/hooks';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import type { Activation, LicenseLimits } from '@/lib/license-client';
import { formatDateTime } from '@/lib/format';
import { notifyRateLimited } from '@/lib/notify';
import { brandButtonStyle, brandTextButtonStyle } from '@/components/brandButtonStyle';
import { US_TIMEZONE_OPTIONS, zonedDateTimeToIso } from '@/lib/timezone';
import { limitsToFormValues, buildLimits, type LimitsFormValues } from '@/lib/limits-form';
import { LimitsFieldset } from '@/components/LimitsFieldset';
import {
  deactivateByInstanceIdAction,
  deleteLicenseAction,
  reissueActivationTokenAction,
  setLicenseRevokedAction,
  updateLicenseNotesAction,
  updateLicenseTermsAction,
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

type EditTermsValues = {
  perpetual: boolean;
  expires_date: string;
  expires_time: string;
  expires_timezone: string;
  unlimitedSeats: boolean;
  max_activations: number;
  limits: LimitsFormValues;
};

// Splits a UTC ISO timestamp into the date/time parts the "Expires on" /
// "At" inputs below expect - defaults the timezone selector to 'UTC'
// (matching lib/format.ts's own "always show/edit in UTC" convention)
// rather than guessing at whatever zone the license was originally
// issued in, which this console never stores.
function isoToDateTimeParts(iso: string): { date: string; time: string } {
  const asUtc = new Date(iso).toISOString();
  return { date: asUtc.slice(0, 10), time: asUtc.slice(11, 16) };
}

// Pre-launch gap analysis finding #1 ("the real work" - license
// mutation). Lets an admin change expires_at, limits, and/or
// max_activations on an already-issued license without deleting and
// re-issuing it (which would cascade away every activation - see
// casazium/license's own update-license-terms.js docblock). Always
// resends all three fields as shown in the form (a full save, not a
// client-side partial diff) - simpler and less surprising than trying to
// infer which fields the admin "meant" to leave untouched.
export function EditTermsButton({
  licenseKey,
  expiresAt,
  maxActivations,
  limits,
}: {
  licenseKey: string;
  expiresAt: string | null;
  maxActivations: number | null;
  limits: LicenseLimits;
}) {
  const router = useRouter();
  const [opened, { open, close }] = useDisclosure(false);
  const [saving, setSaving] = useState(false);

  const initialExpiry = expiresAt ? isoToDateTimeParts(expiresAt) : isoToDateTimeParts(new Date().toISOString());

  const form = useForm<EditTermsValues>({
    initialValues: {
      perpetual: expiresAt === null,
      expires_date: initialExpiry.date,
      expires_time: initialExpiry.time,
      expires_timezone: 'UTC',
      unlimitedSeats: maxActivations === null,
      max_activations: maxActivations ?? 1,
      limits: limitsToFormValues(limits),
    },
    validate: {
      expires_date: (value, values) => (values.perpetual || value ? null : 'Required'),
      expires_time: (value, values) =>
        values.perpetual || /^\d{2}:\d{2}$/.test(value) ? null : 'Required',
    },
  });

  function handleOpen() {
    form.reset();
    open();
  }

  async function handleSave(values: EditTermsValues) {
    setSaving(true);
    try {
      const result = await updateLicenseTermsAction({
        key: licenseKey,
        expires_at: values.perpetual
          ? null
          : zonedDateTimeToIso(values.expires_date, values.expires_time, values.expires_timezone),
        max_activations: values.unlimitedSeats ? null : values.max_activations,
        limits: buildLimits(values.limits) ?? {},
      });
      if (!result.ok) {
        notifyRateLimited();
        return;
      }
      // A lowered seat cap below what's already in use, or a limits
      // change that leaves an already-metered value over its new cap,
      // both succeed (soft cap - see the backend route's own docblock)
      // but are worth flagging rather than looking like silent success.
      if (
        result.data.max_activations !== null &&
        result.data.activations_count > result.data.max_activations
      ) {
        notifications.show({
          color: 'yellow',
          title: 'Seat count is now over the new limit',
          message: `${result.data.activations_count} activations exist, but max_activations is now ${result.data.max_activations}. Existing activations are unaffected; no new ones can be created until usage drops back under the new limit.`,
          autoClose: 8000,
        });
      }
      notifications.show({ color: 'green', title: 'License terms updated', message: licenseKey });
      close();
      router.refresh();
    } catch {
      notifications.show({
        color: 'red',
        title: 'Failed to update license terms',
        message: 'Something went wrong. Please try again.',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button variant="default" onClick={handleOpen}>
        Edit terms
      </Button>

      <Modal opened={opened} onClose={close} title="Edit license terms" size="lg">
        <form onSubmit={form.onSubmit(handleSave)} noValidate>
          <Stack>
            <Checkbox
              label="Perpetual (never expires)"
              {...form.getInputProps('perpetual', { type: 'checkbox' })}
            />
            {!form.values.perpetual && (
              <Group grow align="flex-start">
                <DateInput
                  label="Expires on"
                  valueFormat="YYYY-MM-DD"
                  required
                  {...form.getInputProps('expires_date')}
                />
                <TimeInput label="At" required {...form.getInputProps('expires_time')} />
                <Select
                  label="Time zone"
                  data={US_TIMEZONE_OPTIONS}
                  allowDeselect={false}
                  {...form.getInputProps('expires_timezone')}
                />
              </Group>
            )}

            <Checkbox
              label="Unlimited seats"
              {...form.getInputProps('unlimitedSeats', { type: 'checkbox' })}
            />
            {!form.values.unlimitedSeats && (
              <NumberInput
                label="Max activations"
                min={1}
                {...form.getInputProps('max_activations')}
              />
            )}

            <LimitsFieldset form={form} fieldPrefix="limits" />

            <Group justify="flex-end">
              <Button variant="default" onClick={close} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" loading={saving} style={brandButtonStyle}>
                Save
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </>
  );
}

export function ActivationsTable({
  licenseKey,
  activations,
}: {
  licenseKey: string;
  activations: Activation[];
}) {
  const router = useRouter();
  const [busyInstance, setBusyInstance] = useState<string | null>(null);
  const [confirmInstance, setConfirmInstance] = useState<string | null>(null);

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

  // Beta-readiness finding (BETA_LAUNCH_STATUS.md §4): the backend route
  // (POST /admin/deactivate-by-instance-id, casazium/license) has existed
  // since R3-LICENSE-M1 as the recovery path for activation-slot
  // exhaustion, but the console never wired it into the UI - the most
  // likely recurring support ticket ("customer reimaged their laptop,
  // burned the last seat") had no self-service fix. Confirmed via a
  // Mantine Modal, not window.confirm() - see RevokeDeleteActions' own
  // delete modal above for why (not part of the page DOM, can't be
  // styled/screenshotted/tested).
  async function handleDeactivate(instanceId: string) {
    setConfirmInstance(null);
    setBusyInstance(instanceId);
    try {
      const result = await deactivateByInstanceIdAction(licenseKey, instanceId);
      if (!result.ok) {
        notifyRateLimited();
        return;
      }
      if (!result.data) {
        notifications.show({ color: 'red', title: 'Deactivate failed', message: instanceId });
        return;
      }
      notifications.show({ color: 'orange', title: 'Activation deactivated', message: instanceId });
      router.refresh();
    } catch {
      notifications.show({
        color: 'red',
        title: 'Deactivate failed',
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
    <>
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
                <Group gap="xs" justify="flex-end" wrap="nowrap">
                  <Button
                    size="xs"
                    variant="subtle"
                    style={brandTextButtonStyle}
                    loading={busyInstance === activation.instance_id}
                    onClick={() => handleReissue(activation.instance_id)}
                  >
                    Reissue token
                  </Button>
                  <Button
                    size="xs"
                    variant="subtle"
                    color="red"
                    loading={busyInstance === activation.instance_id}
                    onClick={() => setConfirmInstance(activation.instance_id)}
                  >
                    Deactivate
                  </Button>
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <Modal
        opened={confirmInstance !== null}
        onClose={() => setConfirmInstance(null)}
        title="Deactivate this instance"
        centered
      >
        <Text size="sm">
          Free up this seat on <b>{confirmInstance}</b>? The instance will need to activate again to
          resume using this license.
        </Text>
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={() => setConfirmInstance(null)}>
            Cancel
          </Button>
          <Button color="red" onClick={() => confirmInstance && handleDeactivate(confirmInstance)}>
            Deactivate
          </Button>
        </Group>
      </Modal>
    </>
  );
}
