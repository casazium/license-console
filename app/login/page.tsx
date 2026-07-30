'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, PasswordInput, Stack, Text, Title } from '@mantine/core';
import { useForm } from '@mantine/form';

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const form = useForm({
    initialValues: { password: '' },
    validate: {
      password: (value) => (value.length > 0 ? null : 'Password is required'),
    },
  });

  async function handleSubmit(values: { password: string }) {
    setLoading(true);
    setError(null);

    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });

    setLoading(false);

    if (!response.ok) {
      setError('Incorrect password');
      return;
    }

    router.push('/dashboard');
    router.refresh();
  }

  return (
    <Stack align="center" justify="center" mih="100vh" p="md">
      <Card withBorder shadow="sm" padding="lg" w={360}>
        <form onSubmit={form.onSubmit(handleSubmit)} noValidate>
          <Stack>
            <Title order={3}>License Console</Title>
            <PasswordInput label="Admin password" autoFocus {...form.getInputProps('password')} />
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
    </Stack>
  );
}
