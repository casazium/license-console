import { Text } from '@mantine/core';
import { getBackendMode } from '@/lib/license-client';

// Shared across dashboard/licenses/licenses/[key] - shows only in
// standalone (mock) mode. Was previously hardcoded unconditionally on all
// three pages, which meant it kept claiming "not yet wired to the real
// license server" even once genuinely connected to one - a real, confirmed
// bug caught during live-mode verification.
export function MockDataNotice() {
  if (getBackendMode() !== 'mock') {
    return null;
  }

  return (
    <Text c="dimmed" size="sm" mt="md">
      Showing mock data (lib/license-client.ts) — standalone mode, not
      connected to a real license server. Set LICENSE_API_URL and
      LICENSE_ADMIN_API_KEY to connect one.
    </Text>
  );
}
