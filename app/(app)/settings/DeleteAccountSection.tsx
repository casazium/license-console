'use client';

import { useState } from 'react';
import { unstable_rethrow } from 'next/navigation';
import { Alert, Box, Button, Group, List, Modal, PasswordInput, Stack, Text, Title } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { deleteAccountAction } from './actions';
import { notifyRateLimited } from '@/lib/notify';

/**
 * BETA_LAUNCH_STATUS.md §4, account-settings gap. Deliberately its own
 * section, not folded into the API access card above it - this is the
 * one destructive, irreversible action on this page, and the warning
 * copy below is the actual point of building this (a tenant should be
 * able to see, before confirming, exactly what "delete" means here:
 * immediate and permanent, not a deactivation).
 */
export function DeleteAccountSection() {
  const [opened, { open, close }] = useDisclosure(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function handleClose() {
    if (busy) return;
    setPassword('');
    setError(null);
    close();
  }

  async function handleConfirm() {
    setError(null);
    setBusy(true);
    try {
      // A resolved promise here always means the delete did NOT happen -
      // see actions.ts's own comment: on success it calls redirect('/login')
      // instead of returning, which avoids a real bug where a plain
      // return value made Next re-render /settings afterward and briefly
      // flash an "Unauthorized" error boundary (the account/session were
      // already gone by then).
      const result = await deleteAccountAction(password);
      if (result.reason === 'invalid-password') {
        setError('Incorrect password');
      } else {
        notifyRateLimited();
      }
      setBusy(false);
    } catch (err) {
      // redirect() itself works by throwing a special digest-tagged
      // error, which propagates here as a rejected promise on the
      // success path - not a real failure. Confirmed live (reported
      // directly by the operator): without this check, a *successful*
      // delete still showed "Failed to delete account" right before
      // landing on /login, since this catch block was swallowing that
      // signal and treating it as a genuine error. unstable_rethrow
      // detects Next's own control-flow errors (redirect, notFound) and
      // rethrows them so the framework can still complete the
      // navigation; anything else falls through to the real error toast
      // below.
      unstable_rethrow(err);
      notifications.show({
        color: 'red',
        title: 'Failed to delete account',
        message: 'Something went wrong. Please try again.',
      });
      setBusy(false);
    }
  }

  return (
    <Box mt="xl" pt="lg" style={{ borderTop: '1px solid var(--mantine-color-red-3)' }}>
      <Title order={3} c="red">
        Danger zone
      </Title>
      <Text size="sm" c="dimmed" mt={4} mb="md">
        Permanently delete your account and every license, activation, and usage record it owns.
      </Text>
      <Button color="red" variant="outline" onClick={open}>
        Delete account
      </Button>

      <Modal opened={opened} onClose={handleClose} title="Delete account" centered>
        <Stack>
          <Alert color="red" variant="light" title="This cannot be undone">
            Deleting your account is immediate and permanent - there is no grace period and no way to
            recover it afterward. This will:
            <List size="sm" mt="xs">
              <List.Item>
                Stop every license you&apos;ve issued from working right away, including for any of your
                own customers with an active activation
              </List.Item>
              <List.Item>Permanently delete every license key, activation, and usage record</List.Item>
              <List.Item>Cancel any subscription and end your access to this console</List.Item>
            </List>
          </Alert>

          <PasswordInput
            label="Confirm your password"
            placeholder="Password"
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
            error={error}
            data-autofocus
          />

          <Group justify="flex-end">
            <Button variant="default" onClick={handleClose} disabled={busy}>
              Cancel
            </Button>
            <Button color="red" onClick={handleConfirm} loading={busy} disabled={!password}>
              Permanently delete account
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Box>
  );
}
