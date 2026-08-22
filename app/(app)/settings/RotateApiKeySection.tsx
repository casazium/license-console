'use client';

import { useState } from 'react';
import { Alert, Box, Button, Group, List, Modal, PasswordInput, Stack, Text, Title } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { rotateApiKeyAction } from './actions';
import { ApiKeyReveal } from './ApiKeyReveal';
import { notifyRateLimited } from '@/lib/notify';

/**
 * BETA_LAUNCH_STATUS.md §4, API-key-rotation gap. A leaked key (committed
 * to a repo, embedded in a client build) had no self-service recovery -
 * the only options were emailing an operator with no listed contact
 * method, or deleting the whole account (DeleteAccountSection below) and
 * re-issuing every license from scratch.
 *
 * Hard cutover (operator decision, matching casazium/license's own
 * rotate-own-api-key.js): the old key stops authenticating the instant
 * rotation succeeds, not after some grace window. The warning copy below
 * exists specifically to make that consequence visible before confirming
 * - same reasoning as DeleteAccountSection's own warning, just for a
 * recoverable-but-disruptive action instead of a permanent one.
 */
export function RotateApiKeySection() {
  const [opened, { open, close }] = useDisclosure(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newApiKey, setNewApiKey] = useState<string | null>(null);
  // Security review finding: the license-server rotation and this
  // console's own local persist are two separate steps - a failure in
  // the second one still means a real, working new key exists that the
  // tenant needs to see and save now, just with an extra warning that
  // this console's own stored copy (Settings' own display, every other
  // Server Action in this app) may still be using the old one until
  // that's resolved.
  const [localSyncFailed, setLocalSyncFailed] = useState(false);

  function handleClose() {
    if (busy) return;
    setPassword('');
    setError(null);
    setNewApiKey(null);
    setLocalSyncFailed(false);
    close();
  }

  async function handleConfirm() {
    setError(null);
    setBusy(true);
    try {
      const result = await rotateApiKeyAction(password);
      if ('reason' in result) {
        if (result.reason === 'invalid-password') {
          setError('Incorrect password');
        } else {
          notifyRateLimited();
        }
      } else {
        // Success - swap the confirm form for the new key, rather than
        // closing outright, so there's a clear "copy this now" moment
        // before the modal goes away.
        setNewApiKey(result.apiKey);
        setLocalSyncFailed(Boolean(result.localSyncFailed));
      }
    } catch {
      notifications.show({
        color: 'red',
        title: 'Failed to rotate API key',
        message: 'Something went wrong. Please try again.',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box mt="xl" pt="lg" style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
      <Title order={3}>Rotate API key</Title>
      <Text size="sm" c="dimmed" mt={4} mb="md">
        Mint a new API key and immediately retire the current one — use this if your key is ever
        exposed.
      </Text>
      <Button color="yellow.8" variant="outline" onClick={open}>
        Rotate API key
      </Button>

      <Modal opened={opened} onClose={handleClose} title="Rotate API key" centered>
        {newApiKey ? (
          <Stack>
            <Alert color="teal" variant="light" title="Rotated">
              Your old API key no longer works. Copy your new key below and update any of your own
              systems that were using the old one.
            </Alert>
            {localSyncFailed && (
              <Alert color="orange" variant="light" title="Couldn't save your new key here">
                Your key rotated successfully and the one below is real and working, but this
                console couldn&apos;t save a local copy of it. Copy it now - this page may keep
                showing your old key until that&apos;s resolved, and if you get signed out
                unexpectedly, use your new key or contact support.
              </Alert>
            )}
            <ApiKeyReveal apiKey={newApiKey} />
            <Group justify="flex-end">
              <Button onClick={handleClose}>Done</Button>
            </Group>
          </Stack>
        ) : (
          <Stack>
            <Alert color="yellow" variant="light" title="This takes effect immediately">
              Rotating your API key:
              <List size="sm" mt="xs">
                <List.Item>
                  Stops your current API key from working right away — there is no overlap window
                </List.Item>
                <List.Item>
                  Breaks any of your own systems still using the old key, until you update them
                  with the new one
                </List.Item>
                <List.Item>Does not affect any license you&apos;ve already issued</List.Item>
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
              <Button color="yellow.8" onClick={handleConfirm} loading={busy} disabled={!password}>
                Rotate API key
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Box>
  );
}
