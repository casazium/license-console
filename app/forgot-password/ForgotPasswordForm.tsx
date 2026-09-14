'use client';

import { useState } from 'react';
import { Alert, Button, Card, Stack, Text, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { brandButtonStyle } from '@/components/brandButtonStyle';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ForgotPasswordValues = { email: string };

export function ForgotPasswordForm() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const form = useForm<ForgotPasswordValues>({
    initialValues: { email: '' },
    validate: {
      email: (value) => (EMAIL_RE.test(value) ? null : 'A valid email is required'),
    },
  });

  async function handleSubmit(values: ForgotPasswordValues) {
    setLoading(true);
    setError(null);

    const response = await fetch('/api/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });

    setLoading(false);

    if (response.status === 429) {
      const body = await response.json().catch(() => null);
      setError(body?.error ?? 'Too many requests. Try again later.');
      return;
    }

    // Every other outcome (including a genuinely unregistered email)
    // shows the same success state deliberately - app/api/forgot-password's
    // own header comment explains why this never confirms or denies an
    // email is registered.
    setSent(true);
  }

  if (sent) {
    return (
      <Card withBorder shadow="none" padding="lg" maw={360} w="100%">
        <Alert color="blue" title="Check your email">
          If that email is registered, we&apos;ve sent a link to reset your password.
        </Alert>
      </Card>
    );
  }

  return (
    <Card withBorder shadow="none" padding="lg" maw={360} w="100%">
      <form onSubmit={form.onSubmit(handleSubmit)} noValidate>
        <Stack>
          <Text size="sm" c="dimmed">
            Enter your email and we&apos;ll send you a link to reset your password.
          </Text>
          <TextInput label="Email" type="email" autoFocus {...form.getInputProps('email')} />
          {error && (
            <Text c="red" size="sm">
              {error}
            </Text>
          )}
          <Button type="submit" loading={loading} fullWidth style={brandButtonStyle}>
            Send reset link
          </Button>
        </Stack>
      </form>
    </Card>
  );
}
