'use client';

import { Group, Select, TextInput } from '@mantine/core';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export function LicensesFilters({
  status,
  productId,
}: {
  status?: string;
  productId?: string;
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
          { value: 'active', label: 'Active' },
          { value: 'revoked', label: 'Revoked' },
        ]}
        value={status ?? null}
        onChange={(value) => updateParam('status', value)}
        w={160}
      />
      {/*
        Plain text, not a dropdown: the real backend has no products
        table and no "list distinct products" endpoint - product_id is a
        free-text field the admin types when issuing a license (see
        PROJECT_STATUS.md §4), so there's no canonical list to source
        dropdown options from without inventing one.
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
    </Group>
  );
}
