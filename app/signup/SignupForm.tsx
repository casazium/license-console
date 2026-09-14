'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Anchor, Button, Card, Checkbox, PasswordInput, Stack, Text, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { brandButtonStyle } from '@/components/brandButtonStyle';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

type SignupValues = { email: string; password: string; tenantName: string; agreedToTerms: boolean };

export function SignupForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const form = useForm<SignupValues>({
    initialValues: { email: '', password: '', tenantName: '', agreedToTerms: false },
    validate: {
      email: (value) => (EMAIL_RE.test(value) ? null : 'A valid email is required'),
      password: (value) =>
        value.length >= MIN_PASSWORD_LENGTH ? null : `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      tenantName: (value) => (value.trim().length > 0 ? null : 'Company/organization name is required'),
      agreedToTerms: (value) => (value ? null : 'You must agree to the Terms of Service and Privacy Policy'),
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

    // SaaS-B5: every successful signup is a brand new, license-less
    // tenant - straight to onboarding, not the (empty) dashboard.
    router.push('/onboarding');
    router.refresh();
  }

  return (
    <Card withBorder shadow="none" padding="lg" maw={360} w="100%">
      <form onSubmit={form.onSubmit(handleSubmit)} noValidate>
        <Stack>
          <TextInput label="Company / organization" autoFocus {...form.getInputProps('tenantName')} />
          <TextInput label="Email" type="email" {...form.getInputProps('email')} />
          <PasswordInput label="Password" {...form.getInputProps('password')} />
          <Checkbox
            label={
              <>
                I agree to the{' '}
                <Anchor href="https://casazium.com/terms" target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                  Terms of Service
                </Anchor>{' '}
                and{' '}
                <Anchor href="https://casazium.com/privacy" target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                  Privacy Policy
                </Anchor>
              </>
            }
            {...form.getInputProps('agreedToTerms', { type: 'checkbox' })}
          />
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
