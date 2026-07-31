'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, PasswordInput, Stack, Text, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const form = useForm({
    initialValues: { username: '', password: '' },
    validate: {
      username: (value) => (value.trim().length > 0 ? null : 'Username is required'),
      password: (value) => (value.length > 0 ? null : 'Password is required'),
    },
  });

  async function handleSubmit(values: { username: string; password: string }) {
    setLoading(true);
    setError(null);

    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });

    setLoading(false);

    if (!response.ok) {
      setError('Invalid username or password');
      return;
    }

    router.push('/dashboard');
    router.refresh();
  }

  return (
    <Card withBorder shadow="sm" padding="lg" w={360}>
      <form onSubmit={form.onSubmit(handleSubmit)} noValidate>
        <Stack>
          <TextInput label="Username" autoFocus {...form.getInputProps('username')} />
          <PasswordInput label="Password" {...form.getInputProps('password')} />
          {error && (
            <Text c="red" size="sm">
              {error}
            </Text>
          )}
          <Button type="submit" loading={loading} fullWidth>
            Sign in
          </Button>
        </Stack>
      </form>
    </Card>
  );
}
