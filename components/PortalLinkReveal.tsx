'use client';

import { Button, Code, CopyButton, Group, Text, TextInput } from '@mantine/core';

/**
 * TASK_A1_LICENSE_PORTAL.md - shows a newly issued/reissued portal link
 * once, the only time it's ever available (retrievable again only via a
 * reissue, which rotates it - it cannot be looked up later). A transient
 * notification toast is the wrong shape for a value this consequential to
 * lose (easy to dismiss by accident, gone forever if you do) - same
 * reasoning ApiKeyReveal.tsx/ApiBaseUrlDisplay.tsx (Settings page) already
 * established for this codebase's other one-time/sensitive values, and
 * the same Copy-button pattern, reused rather than reinvented.
 *
 * Not masked like ApiKeyReveal's PasswordInput - that field hides an admin
 * credential worth not leaving on-screen by accident, but this value's
 * entire purpose is to be shared with the customer immediately (pasted
 * into an email/receipt), not kept secret from whoever's looking at this
 * screen.
 */
export function PortalLinkReveal({ portalLink, token }: { portalLink: string | null; token: string }) {
  const value = portalLink ?? token;

  return (
    <div>
      <Text size="sm" fw={500} mb={4}>
        Portal link
      </Text>
      <Group gap="xs" wrap="nowrap" align="center">
        <TextInput value={value} readOnly style={{ flex: 1 }} />
        <CopyButton value={value}>
          {({ copied, copy }) => (
            <Button onClick={copy} color={copied ? 'teal' : undefined} variant={copied ? 'filled' : 'default'}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
          )}
        </CopyButton>
      </Group>
      {!portalLink && (
        <Text size="xs" c="dimmed" mt={4}>
          No LICENSE_API_URL is configured, so only the raw token could be resolved - share it as{' '}
          <Code>{'<your-license-api-url>'}/portal/{token}</Code>.
        </Text>
      )}
      <Text size="xs" c="dimmed" mt={4}>
        This is the only time this link will be shown. Give it to your customer now (in whatever
        delivery email/receipt you already send) - if it&rsquo;s lost later, reissue a fresh one
        from this license&rsquo;s page.
      </Text>
    </div>
  );
}
