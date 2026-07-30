'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, NumberInput, Stack, TextInput, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { issueLicenseAction } from '../actions';

type IssueLicenseValues = {
  product_id: string;
  tier: string;
  issued_to: string;
  expires_at: string;
  max_activations: number;
};

export default function NewLicensePage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<IssueLicenseValues>({
    initialValues: {
      product_id: '',
      tier: '',
      issued_to: '',
      expires_at: '',
      max_activations: 1,
    },
    validate: {
      product_id: (value) => (value.trim() ? null : 'Required'),
      tier: (value) => (value.trim() ? null : 'Required'),
      issued_to: (value) => (value.trim() ? null : 'Required'),
      expires_at: (value) =>
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)
          ? null
          : 'Use ISO 8601, e.g. 2027-01-01T00:00:00Z',
    },
  });

  async function handleSubmit(values: IssueLicenseValues) {
    setSubmitting(true);
    try {
      const license = await issueLicenseAction(values);
      notifications.show({
        color: 'green',
        title: 'License issued',
        message: license.key,
      });
      router.push(`/licenses/${license.key}`);
    } catch {
      notifications.show({
        color: 'red',
        title: 'Failed to issue license',
        message: 'Something went wrong. Please try again.',
      });
      setSubmitting(false);
    }
  }

  return (
    <>
      <Title order={2} mb="md">
        Issue license
      </Title>
      <form onSubmit={form.onSubmit(handleSubmit)} noValidate>
        <Stack maw={480}>
          <TextInput label="Product ID" required {...form.getInputProps('product_id')} />
          <TextInput label="Tier" required {...form.getInputProps('tier')} />
          <TextInput label="Issued to" required {...form.getInputProps('issued_to')} />
          <TextInput
            label="Expires at"
            placeholder="2027-01-01T00:00:00Z"
            description="ISO 8601 date-time"
            required
            {...form.getInputProps('expires_at')}
          />
          <NumberInput label="Max activations" min={1} {...form.getInputProps('max_activations')} />
          <Button type="submit" loading={submitting}>
            Issue license
          </Button>
        </Stack>
      </form>
    </>
  );
}
