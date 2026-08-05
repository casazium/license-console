'use client';

import { useState } from 'react';
import { Alert, Button, Group, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';

export function EmailVerificationBanner() {
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleResend() {
    setLoading(true);
    try {
      const res = await fetch('/api/verify-email/resend', { method: 'POST' });
      if (res.status === 429) {
        notifications.show({
          color: 'yellow',
          title: 'Too many requests',
          message: 'Please wait a few minutes and try again.',
        });
        return;
      }
      if (!res.ok) {
        throw new Error('Resend failed');
      }
      setSent(true);
    } catch {
      notifications.show({
        color: 'red',
        title: 'Failed to resend',
        message: 'Something went wrong. Please try again.',
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Alert color="yellow" mb="md">
      <Group justify="space-between" wrap="nowrap" gap="md">
        <Text size="sm">Please verify your email address to secure your account.</Text>
        <Button
          size="xs"
          variant="light"
          color="yellow"
          loading={loading}
          disabled={sent}
          onClick={handleResend}
        >
          {sent ? 'Email sent' : 'Resend email'}
        </Button>
      </Group>
    </Alert>
  );
}
