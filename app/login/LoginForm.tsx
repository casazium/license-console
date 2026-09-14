'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, PasswordInput, Stack, Text, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { brandButtonStyle } from '@/components/brandButtonStyle';

// Under MULTI_TENANT, lib/auth.ts's verifyCredentials() matches this
// field against accounts.email - there's no separate username concept
// in SaaS mode at all (see lib/db/schema.sql's accounts table). The
// field/payload name stays `username` either way (app/api/login/route.ts,
// and self-hosted's own ADMIN_UI_USERNAME still needs it), only the
// label/input type shown to the person typing into it changes.
export function LoginForm({ multiTenant = false }: { multiTenant?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const form = useForm({
    initialValues: { username: '', password: '' },
    validate: {
      username: (value) =>
        value.trim().length > 0 ? null : multiTenant ? 'Email is required' : 'Username is required',
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
    <Card withBorder shadow="none" padding="lg" maw={360} w="100%">
      <form onSubmit={form.onSubmit(handleSubmit)} noValidate>
        <Stack>
          <TextInput
            label={multiTenant ? 'Email' : 'Username'}
            type={multiTenant ? 'email' : 'text'}
            autoFocus
            {...form.getInputProps('username')}
          />
          <PasswordInput label="Password" {...form.getInputProps('password')} />
          {error && (
            <Text c="red" size="sm">
              {error}
            </Text>
          )}
          <Button type="submit" loading={loading} fullWidth style={brandButtonStyle}>
            Sign in
          </Button>
        </Stack>
      </form>
    </Card>
  );
}
