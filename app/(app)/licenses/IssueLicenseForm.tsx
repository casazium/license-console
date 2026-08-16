'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Anchor,
  Button,
  Group,
  NumberInput,
  Select,
  Stack,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { DateInput, TimeInput } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { issueLicenseAction } from './actions';
import { brandButtonStyle } from '@/components/brandButtonStyle';
import { US_TIMEZONE_OPTIONS, zonedDateTimeToIso } from '@/lib/timezone';
import { notifyRateLimited, notifyOverQuota, notifyPaymentFailed, notifyProductIdTaken } from '@/lib/notify';
import { LimitsFieldset } from '@/components/LimitsFieldset';
import { INITIAL_LIMITS, buildLimits, type LimitsFormValues } from '@/lib/limits-form';

type IssueLicenseValues = {
  product_id: string;
  tier: string;
  issued_to: string;
  expires_date: string;
  expires_time: string;
  expires_timezone: string;
  max_activations: number;
  notes: string;
  limits: LimitsFormValues;
};

function todayDateString(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Shared by app/(app)/licenses/new/page.tsx and app/(app)/onboarding/
 * (SaaS-B5) - identical fields, validation, and submit/error handling
 * either way; only the surrounding copy and the optional "Skip for now"
 * link (onboarding-only) differ. `skipHref` is a plain string, not a
 * pre-rendered `<Anchor>`/`ReactNode` passed down from the (Server
 * Component) caller - passing a component reference like `next/link`'s
 * `Link` as a prop value across the Server/Client boundary isn't
 * serializable ("Functions cannot be passed directly to Client
 * Components" - confirmed directly, this crashed the page entirely
 * before being narrowed to a plain string here). Rendered internally so
 * `Link` is only ever used within this already-client component.
 */
export function IssueLicenseForm({
  heading,
  submitLabel,
  skipHref,
}: {
  heading: string;
  submitLabel: string;
  skipHref?: string;
}) {
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
      notes: '',
      limits: INITIAL_LIMITS,
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
      const result = await issueLicenseAction({
        product_id: values.product_id,
        tier: values.tier,
        issued_to: values.issued_to,
        expires_at: zonedDateTimeToIso(
          values.expires_date,
          values.expires_time,
          values.expires_timezone,
        ),
        max_activations: values.max_activations,
        notes: values.notes.trim() || undefined,
        limits: buildLimits(values.limits),
      });
      if (!result.ok) {
        // SaaS-B4: explicit mapping, not a generic "something went wrong" -
        // over-quota and payment-failed each need their own message since
        // they call for a different next action (upgrade vs. fix billing).
        if (result.reason === 'over-quota') {
          notifyOverQuota();
        } else if (result.reason === 'payment-failed') {
          notifyPaymentFailed();
        } else if (result.reason === 'product-id-taken') {
          notifyProductIdTaken();
          form.setFieldError('product_id', 'Already in use - pick a different product ID');
        } else {
          notifyRateLimited();
        }
        setSubmitting(false);
        return;
      }
      notifications.show({
        color: 'green',
        title: 'License issued',
        message: result.data.key,
      });
      router.push(`/licenses/${result.data.key}`);
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
        {heading}
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
          <Textarea
            label="Notes"
            description="Optional internal context - visible to admins only, editable later"
            autosize
            minRows={2}
            {...form.getInputProps('notes')}
          />
          <LimitsFieldset form={form} fieldPrefix="limits" />
          <Button type="submit" loading={submitting} style={brandButtonStyle}>
            {submitLabel}
          </Button>
          {skipHref && (
            <Anchor component={Link} href={skipHref} size="sm" c="dimmed">
              Skip for now
            </Anchor>
          )}
        </Stack>
      </form>
    </>
  );
}
