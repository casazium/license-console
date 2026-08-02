'use client';

import type { CSSProperties } from 'react';
import { Pagination } from '@mantine/core';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

// Same reasoning as brandButtonStyle (components/brandButtonStyle.ts): the
// active-page control should pick up the operator's brand color rather than
// Mantine's default blue, for consistency with the rest of the app's
// primary actions.
const brandPaginationStyle = {
  '--pagination-active-bg': 'var(--brand-color)',
} as CSSProperties;

export function LicensesPagination({ page, totalPages }: { page: number; totalPages: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (totalPages <= 1) {
    return null;
  }

  function goToPage(nextPage: number) {
    const next = new URLSearchParams(searchParams.toString());
    if (nextPage <= 1) {
      next.delete('page');
    } else {
      next.set('page', String(nextPage));
    }
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <Pagination
      total={totalPages}
      value={page}
      onChange={goToPage}
      size="sm"
      style={brandPaginationStyle}
    />
  );
}
