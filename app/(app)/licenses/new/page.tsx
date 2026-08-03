'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Group, NumberInput, Select, Stack, TextInput, Title } from '@mantine/core';
import { DateInput, TimeInput } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { issueLicenseAction } from '../actions';
import { brandButtonStyle } from '@/components/brandButtonStyle';
import { US_TIMEZONE_OPTIONS, zonedDateTimeToIso } from '@/lib/timezone';

type IssueLicenseValues = {
  product_id: string;
  tier: string;
  issued_to: string;
  expires_date: string;
  expires_time: string;
  expires_timezone: string;
  max_activations: number;
};

function todayDateString(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export default function NewLicensePage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<IssueLicenseValues>({
    initialValues: {
      product_id: '',
      tier: '',
      issued_to: '',
      expires_date: todayDateString(),
      expires_time: '00:00',
      expires_timezone: 'America/New_York',
      max_activations: 1,
    },
    validate: {
      product_id: (value) => (value.trim() ? null : 'Required'),
      tier: (value) => (value.trim() ? null : 'Required'),
      issued_to: (value) => (value.trim() ? null : 'Required'),
      expires_date: (value) => (value ? null : 'Required'),
      expires_time: (value) => (/^\d{2}:\d{2}$/.test(value) ? null : 'Required'),
    },
  });

  async function handleSubmit(values: IssueLicenseValues) {
    setSubmitting(true);
    try {
      const license = await issueLicenseAction({
        product_id: values.product_id,
        tier: values.tier,
        issued_to: values.issued_to,
        expires_at: zonedDateTimeToIso(
          values.expires_date,
          values.expires_time,
          values.expires_timezone,
        ),
        max_activations: values.max_activations,
      });
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
          <Group grow align="flex-start">
            <DateInput
              label="Expires on"
              valueFormat="YYYY-MM-DD"
              required
              {...form.getInputProps('expires_date')}
            />
            <TimeInput label="At" required {...form.getInputProps('expires_time')} />
          </Group>
          <Select
            label="Time zone"
            data={US_TIMEZONE_OPTIONS}
            allowDeselect={false}
            {...form.getInputProps('expires_timezone')}
          />
          <NumberInput label="Max activations" min={1} {...form.getInputProps('max_activations')} />
          <Button type="submit" loading={submitting} style={brandButtonStyle}>
            Issue license
          </Button>
        </Stack>
      </form>
    </>
  );
}
