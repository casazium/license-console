'use client';

import { Anchor, CopyButton } from '@mantine/core';

// Extracted out of the (Server Component) release detail page - Next
// doesn't allow a function to be passed as children/props across the
// server/client boundary (CopyButton's own render-prop children, and
// Anchor's `component={Link}` prop elsewhere on that page, are both
// exactly that), so anything needing CopyButton's live clipboard
// interaction has to be its own client component instead.
export function CopyUrlButton({ value }: { value: string }) {
  return (
    <CopyButton value={value}>
      {({ copied, copy }) => (
        <Anchor component="button" onClick={copy} size="sm" style={{ whiteSpace: 'nowrap' }}>
          {copied ? 'Copied' : 'Copy'}
        </Anchor>
      )}
    </CopyButton>
  );
}
