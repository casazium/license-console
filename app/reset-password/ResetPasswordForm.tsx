'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, PasswordInput, Stack, Text } from '@mantine/core';
import { useForm } from '@mantine/form';
import { brandButtonStyle } from '@/components/brandButtonStyle';

const MIN_PASSWORD_LENGTH = 8;

type ResetPasswordValues = { password: string; confirmPassword: string };

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const form = useForm<ResetPasswordValues>({
    initialValues: { password: '', confirmPassword: '' },
    validate: {
      password: (value) =>
        value.length >= MIN_PASSWORD_LENGTH ? null : `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      confirmPassword: (value, values) => (value === values.password ? null : 'Passwords do not match'),
    },
  });

  async function handleSubmit(values: ResetPasswordValues) {
    setLoading(true);
    setError(null);

    const response = await fetch('/api/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password: values.password }),
    });

    setLoading(false);

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.error ?? 'Unable to reset password');
      return;
    }

    // A plain fetch response, not an awaited Server Action call - the
    // client-router navigation issue found in
    // app/(app)/billing/checkout/confirm/StubCheckoutConfirm.tsx doesn't
    // apply here (that was specific to router.push() right after a
    // direct 'use server' function call), same as SignupForm's own
    // equivalent push after its own plain fetch.
    router.push('/dashboard');
    router.refresh();
  }

  return (
    <Card withBorder shadow="none" padding="lg" maw={360} w="100%">
      <form onSubmit={form.onSubmit(handleSubmit)} noValidate>
        <Stack>
          <Text size="sm" c="dimmed">
            Choose a new password for your account.
          </Text>
          <PasswordInput label="New password" autoFocus {...form.getInputProps('password')} />
          <PasswordInput label="Confirm new password" {...form.getInputProps('confirmPassword')} />
          {error && (
            <Text c="red" size="sm">
              {error}
            </Text>
          )}
          <Button type="submit" loading={loading} fullWidth style={brandButtonStyle}>
            Reset password
          </Button>
        </Stack>
      </form>
    </Card>
  );
}
