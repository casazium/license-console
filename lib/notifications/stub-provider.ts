// lib/notify/stub-provider.ts
//
// Stub NotificationProvider (mirrors lib/email/stub-provider.ts) -
// implements provider.ts's interface with no real send. This is the
// default for every deployment that doesn't set NOTIFY_WEBHOOK_URL -
// self-hosted included - so the feature is genuinely opt-in, never a
// behavior change for anyone who hasn't configured it.

import type { NotificationProvider } from './provider';

export function createStubNotificationProvider(): NotificationProvider {
  return {
    async notify(event) {
      console.log(`[stub-notify] ${event.type}`, event);
    },
  };
}
