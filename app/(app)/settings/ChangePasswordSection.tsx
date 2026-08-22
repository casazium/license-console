'use client';

import { useState } from 'react';
import { Alert, Box, Button, Group, Modal, PasswordInput, Stack, Text, Title } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { changePasswordAction } from './actions';

// Matches actions.ts's own MIN_PASSWORD_LENGTH - client-side only for
// the immediate "too short" hint before submitting; the server side is
// what actually enforces it (this is display only, not the guarantee).
const MIN_PASSWORD_LENGTH = 8;

/**
 * BETA_LAUNCH_STATUS.md §4, account-settings gap - mirrors
 * RotateApiKeySection.tsx/DeleteAccountSection.tsx's own
 * open-a-modal-then-re-enter-password pattern, the established
 * interaction for every sensitive action on this page.
 */
export function ChangePasswordSection() {
  const [opened, { open, close }] = useDisclosure(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [currentPasswordError, setCurrentPasswordError] = useState<string | null>(null);
  const [newPasswordError, setNewPasswordError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function handleClose() {
    if (busy) return;
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setCurrentPasswordError(null);
    setNewPasswordError(null);
    close();
  }

  async function handleConfirm() {
    setCurrentPasswordError(null);
    setNewPasswordError(null);

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setNewPasswordError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setNewPasswordError('Passwords do not match');
      return;
    }

    setBusy(true);
    try {
      const result = await changePasswordAction(currentPassword, newPassword);
      if ('reason' in result) {
        if (result.reason === 'incorrect-current-password') {
          setCurrentPasswordError('Incorrect password');
        } else {
          setNewPasswordError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
        }
      } else {
        notifications.show({
          color: 'teal',
          title: 'Password changed',
          message: "Your password was updated. Any other signed-in sessions were signed out — you're still signed in here.",
        });
        handleClose();
      }
    } catch {
      notifications.show({
        color: 'red',
        title: 'Failed to change password',
        message: 'Something went wrong. Please try again.',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box mt="xl" pt="lg" style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
      <Title order={3}>Password</Title>
      <Text size="sm" c="dimmed" mt={4} mb="md">
        Change the password you use to sign in to this console.
      </Text>
      <Button variant="outline" onClick={open}>
        Change password
      </Button>

      <Modal opened={opened} onClose={handleClose} title="Change password" centered>
        <Stack>
          <PasswordInput
            label="Current password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.currentTarget.value)}
            error={currentPasswordError}
            data-autofocus
          />
          <PasswordInput
            label="New password"
            description={`At least ${MIN_PASSWORD_LENGTH} characters`}
            value={newPassword}
            onChange={(event) => setNewPassword(event.currentTarget.value)}
          />
          <PasswordInput
            label="Confirm new password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.currentTarget.value)}
            error={newPasswordError}
          />
          <Alert color="blue" variant="light">
            Changing your password signs out every other session on this account — you&apos;ll stay
            signed in here.
          </Alert>
          <Group justify="flex-end">
            <Button variant="default" onClick={handleClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              onClick={handleConfirm}
              loading={busy}
              disabled={!currentPassword || !newPassword || !confirmPassword}
            >
              Change password
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Box>
  );
}
