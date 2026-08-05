'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, PasswordInput, Stack, Text, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { brandButtonStyle } from '@/components/brandButtonStyle';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

type SignupValues = { email: string; password: string; tenantName: string };

export function SignupForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const form = useForm<SignupValues>({
    initialValues: { email: '', password: '', tenantName: '' },
    validate: {
      email: (value) => (EMAIL_RE.test(value) ? null : 'A valid email is required'),
      password: (value) =>
        value.length >= MIN_PASSWORD_LENGTH ? null : `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      tenantName: (value) => (value.trim().length > 0 ? null : 'Company/organization name is required'),
    },
  });

  async function handleSubmit(values: SignupValues) {
    setLoading(true);
    setError(null);

    const response = await fetch('/api/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });

    setLoading(false);

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.error ?? 'Unable to create account');
      return;
    }

    router.push('/dashboard');
    router.refresh();
  }

  return (
    <Card withBorder shadow="sm" padding="lg" w={360}>
      <form onSubmit={form.onSubmit(handleSubmit)} noValidate>
        <Stack>
          <TextInput label="Company / organization" autoFocus {...form.getInputProps('tenantName')} />
          <TextInput label="Email" type="email" {...form.getInputProps('email')} />
          <PasswordInput label="Password" {...form.getInputProps('password')} />
          {error && (
            <Text c="red" size="sm">
              {error}
            </Text>
          )}
          <Button type="submit" loading={loading} fullWidth style={brandButtonStyle}>
            Create account
          </Button>
        </Stack>
      </form>
    </Card>
  );
}
