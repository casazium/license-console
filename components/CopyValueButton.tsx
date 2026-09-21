'use client';

import { Anchor, CopyButton } from '@mantine/core';

// Moved here from app/(app)/releases/CopyUrlButton.tsx (originally
// release-artifact_url-specific in name only, always generic in
// implementation) once product_uuid needed the identical copy affordance
// on the license detail page and the issue-license success screen -
// genuinely shared across features now, not release-specific.
//
// A real 'use client' component, not inlined into a Server Component page:
// a Server Component can't pass a function - CopyButton's own render-prop
// children here, `Link`'s `component` prop elsewhere - across the
// server/client boundary, so anything needing CopyButton's live clipboard
// interaction has to live in its own client component instead.
export function CopyValueButton({ value }: { value: string }) {
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
