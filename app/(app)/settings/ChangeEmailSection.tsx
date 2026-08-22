'use client';

import { useState } from 'react';
import { Alert, Button, Group, Modal, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';

/**
 * BETA_LAUNCH_STATUS.md §4, account-settings gap. Calls
 * app/api/change-email/route.ts directly via fetch rather than a Server
 * Action - that route needs a real request object to build the
 * confirmation link's public URL from (publicBaseUrl(), see that
 * route's own comment), the same reason every other link-emailing flow
 * in this repo (signup, forgot-password) is a Route Handler too.
 *
 * Two-step, not an immediate swap: this only ever sends a confirmation
 * link to the requested new address - the account's email doesn't
 * change until that link is clicked (verify-email/route.ts). A typo'd
 * address just leaves an unredeemed token, not a locked-out account.
 */
export function ChangeEmailSection({ currentEmail }: { currentEmail: string }) {
  const [opened, { open, close }] = useDisclosure(false);
  const [password, setPassword] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  function handleClose() {
    if (busy) return;
    setPassword('');
    setNewEmail('');
    setError(null);
    setSentTo(null);
    close();
  }

  async function handleConfirm() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/change-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, newEmail }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof body?.error === 'string' ? body.error : 'Something went wrong. Please try again.');
        return;
      }
      setSentTo(newEmail);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Title order={3}>Email</Title>
      <Text size="sm" c="dimmed" mt={4} mb="md">
        Signed in as <strong>{currentEmail}</strong>.
      </Text>
      <Button variant="outline" onClick={open}>
        Change email
      </Button>

      <Modal opened={opened} onClose={handleClose} title="Change email" centered>
        {sentTo ? (
          <Stack>
            <Alert color="teal" variant="light" title="Check your new inbox">
              We sent a confirmation link to {sentTo}. Your account email won&apos;t change until you
              click it — this link expires in 24 hours, and {currentEmail} keeps working until then.
            </Alert>
            <Group justify="flex-end">
              <Button onClick={handleClose}>Done</Button>
            </Group>
          </Stack>
        ) : (
          <Stack>
            <Text size="sm" c="dimmed">
              We&apos;ll send a confirmation link to your new address — your account email
              won&apos;t change until you click it.
            </Text>
            <PasswordInput
              label="Confirm your password"
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
              data-autofocus
            />
            <TextInput
              label="New email"
              type="email"
              placeholder="you@example.com"
              value={newEmail}
              onChange={(event) => setNewEmail(event.currentTarget.value)}
            />
            {error && (
              <Alert color="red" variant="light">
                {error}
              </Alert>
            )}
            <Group justify="flex-end">
              <Button variant="default" onClick={handleClose} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={handleConfirm} loading={busy} disabled={!password || !newEmail}>
                Send confirmation link
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </>
  );
}
