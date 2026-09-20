'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Stack, Textarea, TextInput, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { registerReleaseAction } from './actions';
import { brandButtonStyle } from '@/components/brandButtonStyle';
import {
  notifyRateLimited,
  notifyProductIdTaken,
  notifyProductIdRetired,
  notifyReleasePaymentFailed,
  notifyReservedProductId,
  notifyInvalidArtifactUrl,
  notifyFieldTooLong,
  notifyDuplicateRelease,
  notifyReleaseLimitReached,
} from '@/lib/notify';

// Mirrors register-release.js's own maxLength values (round-6 focused
// review, findings R6-3/R6-4) - kept as a single source for both the
// client-side validators below and the notification copy, so a future
// limit change only needs updating in one place here (the backend's own
// schema is still the real enforcement point either way).
const MAX_LENGTHS = {
  product_id: 200,
  version: 100,
  channel: 100,
  platform: 100,
  artifact_url: 2048,
  checksum: 256,
  release_notes: 10000,
} as const;

type RegisterReleaseValues = {
  product_id: string;
  version: string;
  channel: string;
  platform: string;
  artifact_url: string;
  checksum: string;
  release_notes: string;
};

export function RegisterReleaseForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<RegisterReleaseValues>({
    initialValues: {
      product_id: '',
      version: '',
      channel: 'stable',
      platform: '',
      artifact_url: '',
      checksum: '',
      release_notes: '',
    },
    validate: {
      // Length checks added for all six previously-uncovered fields
      // (round-6 focused review, finding R6-3) - only release_notes had
      // one before, even though register-release.js bounds all seven.
      product_id: (value) =>
        !value.trim()
          ? 'Required'
          : value.length > MAX_LENGTHS.product_id
            ? `Must be ${MAX_LENGTHS.product_id.toLocaleString()} characters or fewer (currently ${value.length})`
            : null,
      version: (value) =>
        !value.trim()
          ? 'Required'
          : value.length > MAX_LENGTHS.version
            ? `Must be ${MAX_LENGTHS.version.toLocaleString()} characters or fewer (currently ${value.length})`
            : null,
      channel: (value) =>
        !value.trim()
          ? 'Required'
          : value.length > MAX_LENGTHS.channel
            ? `Must be ${MAX_LENGTHS.channel.toLocaleString()} characters or fewer (currently ${value.length})`
            : null,
      platform: (value) =>
        !value.trim()
          ? 'Required'
          : value.length > MAX_LENGTHS.platform
            ? `Must be ${MAX_LENGTHS.platform.toLocaleString()} characters or fewer (currently ${value.length})`
            : null,
      // Client-side mirror of register-release.js's own checks (round-5
      // independent review, finding F5-6) - catches the common case
      // before a round trip, though the server remains the real
      // enforcement point (isInvalidArtifactUrl/isReleaseNotesTooLong
      // below still handle whatever this misses, e.g. a URL that's
      // syntactically valid but not http(s)).
      artifact_url: (value) => {
        if (!value.trim()) return 'Required';
        if (value.length > MAX_LENGTHS.artifact_url) {
          return `Must be ${MAX_LENGTHS.artifact_url.toLocaleString()} characters or fewer (currently ${value.length})`;
        }
        try {
          const scheme = new URL(value).protocol;
          if (scheme !== 'http:' && scheme !== 'https:') {
            return 'Must be a valid http:// or https:// URL';
          }
        } catch {
          return 'Must be a valid http:// or https:// URL';
        }
        return null;
      },
      checksum: (value) =>
        !value.trim()
          ? 'Required'
          : value.length > MAX_LENGTHS.checksum
            ? `Must be ${MAX_LENGTHS.checksum.toLocaleString()} characters or fewer (currently ${value.length})`
            : null,
      release_notes: (value) =>
        value.length > MAX_LENGTHS.release_notes
          ? `Must be ${MAX_LENGTHS.release_notes.toLocaleString()} characters or fewer (currently ${value.length})`
          : null,
    },
  });

  async function handleSubmit(values: RegisterReleaseValues) {
    setSubmitting(true);
    try {
      const result = await registerReleaseAction({
        product_id: values.product_id,
        version: values.version,
        channel: values.channel,
        platform: values.platform,
        artifact_url: values.artifact_url,
        checksum: values.checksum,
        release_notes: values.release_notes.trim() || undefined,
      });
      if (!result.ok) {
        // Mirrors IssueLicenseForm.tsx's own mapping - product_id
        // ownership is bound to whichever tenant claims it first, so a
        // collision here can't be fixed by retrying the same input.
        // 'payment-failed'/'reserved-product-id' added (round-3
        // independent review, finding C-1): both used to fall through to
        // the generic notifyRateLimited() call below, misleading a
        // billing-blocked tenant into thinking a retry would help.
        if (result.reason === 'product-id-taken') {
          notifyProductIdTaken();
          form.setFieldError('product_id', 'Already in use - pick a different product ID');
        } else if (result.reason === 'product-id-retired') {
          // Distinct from 'product-id-taken' above (security review
          // finding, fresh audit, 2026-09 - permanent product_id
          // retirement, operator follow-up "distinguish the two cases"):
          // nobody owns this product_id, it's retired, so "already in
          // use" would be wrong.
          notifyProductIdRetired();
          form.setFieldError('product_id', 'This product ID has been retired - contact support or pick a different one');
        } else if (result.reason === 'reserved-product-id') {
          notifyReservedProductId();
          form.setFieldError('product_id', 'This product ID is reserved - pick a different one');
        } else if (result.reason === 'payment-failed') {
          notifyReleasePaymentFailed();
        } else if (result.reason === 'invalid-artifact-url') {
          notifyInvalidArtifactUrl();
          form.setFieldError('artifact_url', 'Must be a valid http:// or https:// URL');
        } else if (result.reason === 'release-notes-too-long') {
          // Round-7 focused review, finding R7-5: this used to call the
          // release-notes-only notifyReleaseNotesTooLong() and hardcode
          // "10,000" here, both independently stale of MAX_LENGTHS.
          // release_notes above - the same drift-fragile pattern R6-3/
          // R6-4 already fixed for the other six fields, on the one
          // field they'd originally been generalized from. Uses the
          // same shared notifyFieldTooLong()/MAX_LENGTHS every other
          // branch below already does.
          notifyFieldTooLong('Release notes', MAX_LENGTHS.release_notes);
          form.setFieldError(
            'release_notes',
            `Must be ${MAX_LENGTHS.release_notes.toLocaleString()} characters or fewer`
          );
        } else if (result.reason === 'product-id-too-long') {
          notifyFieldTooLong('Product ID', MAX_LENGTHS.product_id);
          form.setFieldError('product_id', `Must be ${MAX_LENGTHS.product_id.toLocaleString()} characters or fewer`);
        } else if (result.reason === 'version-too-long') {
          notifyFieldTooLong('Version', MAX_LENGTHS.version);
          form.setFieldError('version', `Must be ${MAX_LENGTHS.version.toLocaleString()} characters or fewer`);
        } else if (result.reason === 'channel-too-long') {
          notifyFieldTooLong('Channel', MAX_LENGTHS.channel);
          form.setFieldError('channel', `Must be ${MAX_LENGTHS.channel.toLocaleString()} characters or fewer`);
        } else if (result.reason === 'platform-too-long') {
          notifyFieldTooLong('Platform', MAX_LENGTHS.platform);
          form.setFieldError('platform', `Must be ${MAX_LENGTHS.platform.toLocaleString()} characters or fewer`);
        } else if (result.reason === 'checksum-too-long') {
          notifyFieldTooLong('Checksum', MAX_LENGTHS.checksum);
          form.setFieldError('checksum', `Must be ${MAX_LENGTHS.checksum.toLocaleString()} characters or fewer`);
        } else if (result.reason === 'artifact-url-too-long') {
          notifyFieldTooLong('Artifact URL', MAX_LENGTHS.artifact_url);
          form.setFieldError(
            'artifact_url',
            `Must be ${MAX_LENGTHS.artifact_url.toLocaleString()} characters or fewer`
          );
        } else if (result.reason === 'duplicate-release') {
          notifyDuplicateRelease();
          form.setFieldError('version', 'A published release already exists for this version/channel/platform');
        } else if (result.reason === 'release-limit-reached') {
          notifyReleaseLimitReached();
        } else {
          notifyRateLimited();
        }
        setSubmitting(false);
        return;
      }
      notifications.show({
        color: 'green',
        title: 'Release registered',
        message: `${values.product_id} ${values.version} (${values.channel})`,
      });
      router.push('/releases');
    } catch {
      notifications.show({
        color: 'red',
        title: 'Failed to register release',
        message: 'Something went wrong. Please try again.',
      });
      setSubmitting(false);
    }
  }

  return (
    <>
      <Title order={2} mb="md">
        Register release
      </Title>
      <form onSubmit={form.onSubmit(handleSubmit)} noValidate>
        <Stack maw={480}>
          <TextInput label="Product ID" required {...form.getInputProps('product_id')} />
          <TextInput label="Version" placeholder="2.3.0" required {...form.getInputProps('version')} />
          <TextInput label="Channel" required {...form.getInputProps('channel')} />
          <TextInput
            label="Platform"
            placeholder="darwin-arm64"
            required
            {...form.getInputProps('platform')}
          />
          <TextInput
            label="Artifact URL"
            description="A URL you already host - Casazium never stores or proxies the file itself"
            placeholder="https://cdn.example.com/app-2.3.0.dmg"
            required
            {...form.getInputProps('artifact_url')}
          />
          <TextInput
            label="Checksum"
            placeholder="sha256:..."
            required
            {...form.getInputProps('checksum')}
          />
          <Textarea
            label="Release notes"
            description="Optional - shown to whoever reads this release's manifest"
            autosize
            minRows={2}
            {...form.getInputProps('release_notes')}
          />
          <Button type="submit" loading={submitting} style={brandButtonStyle}>
            Register release
          </Button>
        </Stack>
      </form>
    </>
  );
}
