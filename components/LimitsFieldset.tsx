'use client';

import { Fieldset, NumberInput, SimpleGrid, Stack, TagsInput } from '@mantine/core';
import type { UseFormReturnType } from '@mantine/form';
import { NUMERIC_LIMIT_FIELDS, type LimitsFormValues } from '@/lib/limits-form';

// Shared by IssueLicenseForm.tsx and LicenseActions.tsx's EditTermsButton
// (see lib/limits-form.ts's own header for why) - a plain string
// `fieldPrefix` (e.g. 'limits') rather than a typed path, since Mantine's
// getInputProps takes a dotted string path either way and the two call
// sites' full form value shapes differ beyond this shared `limits` slice.
export function LimitsFieldset({
  form,
  fieldPrefix,
}: {
  form: UseFormReturnType<any>;
  fieldPrefix: string;
}) {
  return (
    <Fieldset legend="Limits (optional)">
      <Stack gap="sm">
        <SimpleGrid cols={2}>
          {NUMERIC_LIMIT_FIELDS.map(({ key, label }) => (
            <NumberInput
              key={key}
              label={label}
              placeholder="No limit"
              min={0}
              {...form.getInputProps(`${fieldPrefix}.${key}`)}
            />
          ))}
        </SimpleGrid>
        <TagsInput
          label="Features"
          description="Press Enter after each feature flag to add it"
          placeholder="Add a feature flag"
          {...form.getInputProps(`${fieldPrefix}.features`)}
        />
      </Stack>
    </Fieldset>
  );
}
