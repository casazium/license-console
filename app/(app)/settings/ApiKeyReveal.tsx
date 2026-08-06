'use client';

import { useState } from 'react';
import { Button, CopyButton, Group, PasswordInput } from '@mantine/core';

// Beta-readiness finding: this tenant's API key was never surfaced
// anywhere in the console (it's provisioned server-to-server at signup
// and only ever decrypted for this console's own outbound calls) despite
// the docs telling every hosted signup to "get an API key and start
// issuing licenses." Masked by default, same as a password field, since
// it's a live bearer credential worth not leaving on-screen by accident.
export function ApiKeyReveal({ apiKey }: { apiKey: string }) {
  const [visible, setVisible] = useState(false);

  return (
    <Group gap="xs" wrap="nowrap" align="flex-end">
      <PasswordInput
        label="Your API key"
        description="Server-side use only - never embed this in client-side/browser code"
        value={apiKey}
        readOnly
        visible={visible}
        onVisibilityChange={setVisible}
        style={{ flex: 1 }}
      />
      <CopyButton value={apiKey}>
        {({ copied, copy }) => (
          <Button onClick={copy} color={copied ? 'teal' : undefined} variant={copied ? 'filled' : 'default'}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
        )}
      </CopyButton>
    </Group>
  );
}
