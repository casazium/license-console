'use client';

import { Group, Select, TextInput } from '@mantine/core';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

// Round-3 independent review, console finding C-3: this UI's own
// list page already parsed product_id/channel/platform/status from
// searchParams, but no filter component ever set them - reachable only
// by hand-editing the URL. Mirrors app/(app)/licenses/LicensesFilters.tsx
// exactly, minus the license-key search field (releases have no
// equivalent single unique identifier a tenant would search by).
export function ReleasesFilters({
  status,
  productId,
  channel,
  platform,
}: {
  status?: string;
  productId?: string;
  channel?: string;
  platform?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function updateParam(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams.toString());
    if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
    }
    next.delete('page'); // changing filters invalidates the current page
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <Group mb="md" align="flex-end">
      <Select
        label="Status"
        placeholder="All"
        clearable
        data={[
          { value: 'published', label: 'Published' },
          { value: 'unpublished', label: 'Unpublished' },
        ]}
        value={status ?? null}
        onChange={(value) => updateParam('status', value)}
        w={160}
      />
      {/*
        Plain text, not a dropdown, same reasoning as LicensesFilters.tsx's
        own Product field - no "list distinct products" endpoint exists to
        source dropdown options from.
      */}
      <TextInput
        label="Product"
        placeholder="Exact product ID"
        defaultValue={productId ?? ''}
        onBlur={(event) => updateParam('product_id', event.currentTarget.value.trim() || null)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur();
          }
        }}
        w={220}
      />
      <TextInput
        label="Channel"
        placeholder="e.g. stable"
        defaultValue={channel ?? ''}
        onBlur={(event) => updateParam('channel', event.currentTarget.value.trim() || null)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur();
          }
        }}
        w={160}
      />
      <TextInput
        label="Platform"
        placeholder="e.g. darwin-arm64"
        defaultValue={platform ?? ''}
        onBlur={(event) => updateParam('platform', event.currentTarget.value.trim() || null)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur();
          }
        }}
        w={200}
      />
    </Group>
  );
}
