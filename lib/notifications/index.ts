// lib/notify/index.ts
//
// Provider selection (TASK_ACCOUNT_NOTIFICATIONS.md), mirroring
// lib/email/index.ts's own selection pattern - but deliberately WITHOUT
// EMAIL_PROVIDER's fail-loud-in-production check. That check exists
// because a silently broken password reset breaks a core account-
// recovery path a user depends on; a silently-off ops notification
// breaks nothing the product promises anyone. "Optional" was explicit in
// the request that scoped this task - an unset NOTIFY_WEBHOOK_URL must
// stay a quiet no-op forever, in every environment, never an error.
//
// No NOTIFY_PROVIDER-style enum either (unlike BILLING_PROVIDER/
// EMAIL_PROVIDER) - selection is purely presence-of-URL. Adding a second
// transport later (Slack, generic JSON, ntfy.sh) is the point at which an
// explicit selector becomes necessary, not before.

import type { NotificationProvider } from './provider';
import { createStubNotificationProvider } from './stub-provider';
import { createDiscordNotificationProvider } from './discord-provider';

export function getNotificationProvider(): NotificationProvider {
  if (!process.env.NOTIFY_WEBHOOK_URL) {
    return createStubNotificationProvider();
  }
  return createDiscordNotificationProvider();
}
