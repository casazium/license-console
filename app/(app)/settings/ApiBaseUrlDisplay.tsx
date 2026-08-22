'use client';

import { Button, Code, CopyButton, Group } from '@mantine/core';
import type { ReactNode } from 'react';

/**
 * UX review finding: the API key right above this got a Copy button
 * (ApiKeyReveal.tsx) but the base URL - the other value a developer
 * needs to paste to actually call the API - didn't, a bare Code block
 * with nothing to click. A client component, not inlined in the async
 * Server Component page.tsx, since CopyButton needs client interactivity
 * - same reasoning ApiKeyReveal.tsx already established for the key
 * field right above this one.
 */
export function ApiBaseUrlDisplay({ apiBaseUrl, fallback }: { apiBaseUrl: string; fallback: ReactNode }) {
  if (!apiBaseUrl) {
    return <Code block>{fallback}</Code>;
  }

  return (
    <Group gap="xs" wrap="nowrap" align="center">
      <Code block style={{ flex: 1 }}>
        {apiBaseUrl}
      </Code>
      <CopyButton value={apiBaseUrl}>
        {({ copied, copy }) => (
          <Button onClick={copy} color={copied ? 'teal' : undefined} variant={copied ? 'filled' : 'default'}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
        )}
      </CopyButton>
    </Group>
  );
}
