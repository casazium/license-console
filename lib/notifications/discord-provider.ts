// lib/notify/discord-provider.ts
//
// Real NotificationProvider implementation against a Discord Incoming
// Webhook. Plain fetch, no SDK dependency - one endpoint, one call
// shape, same "not worth a new package for" reasoning as
// lib/email/resend-provider.ts.
//
// Adversarial review finding (TASK_ACCOUNT_NOTIFICATIONS.md): the first
// draft of this task's scope doc said "plain fetch POST" and assumed the
// same .catch()-based failure handling forgot-password/route.ts uses for
// its own email send would just work here too - it doesn't, on its own.
// fetch() only rejects on a network-level failure, never on an HTTP
// error status. Without the explicit `!res.ok` check below, a Discord
// 429 (real, documented rate limit - roughly 30 messages/minute per
// webhook), 401 (revoked webhook token), or 404 (deleted webhook) would
// all resolve normally and be silently swallowed by a caller's .catch -
// worse than doing nothing, since it looks like working delivery.

import type { NotificationEvent, NotificationProvider } from './provider';

// Adversarial review finding: account.created fires with the signup-
// supplied email, and signup's only validation (EMAIL_RE in
// app/api/signup/route.ts) rejects whitespace and a second '@' and
// nothing else - a string like "a[x](https://evil.example)@b.co" is a
// *valid* signup email under it. Discord renders [text](url) masked
// links, ||spoilers||, backticks, and other markdown inside embed
// fields, so unescaped user-supplied text here is a real injection
// vector into the operator's own Discord channel - the identical bug
// class lib/email/resend-provider.ts's own escapeHtml() already exists
// to close for a different rendering target.
//
// Strips Unicode bidirectional-override control characters first (could
// otherwise visually disguise injected text regardless of markdown
// escaping), then backslash-escapes every Discord markdown special
// character - including both bracket pairs, which is what actually
// breaks [text](url) masked-link syntax - so nothing in a user-supplied
// string can be interpreted as formatting once it reaches an embed.
function sanitizeForDiscord(value: string): string {
  const stripped = value.replace(/[‪-‮⁦-⁩]/g, '');
  return stripped.replace(/([\\*_~`|[\]()@#])/g, '\\$1');
}

const EVENT_TITLES: Record<NotificationEvent['type'], string> = {
  'account.created': 'New account created',
  'account.deleted': 'Account deleted',
  login: 'Login',
  logout: 'Logout',
};

// Decimal RGB, Discord's own embed color format (0xRRGGBB as an int) -
// green/red/blue/gray, one per event type, matching
// TASK_ACCOUNT_NOTIFICATIONS.md's own color table.
const EVENT_COLORS: Record<NotificationEvent['type'], number> = {
  'account.created': 0x2ecc71,
  'account.deleted': 0xe74c3c,
  login: 0x3498db,
  logout: 0x95a5a6,
};

function buildEmbed(event: NotificationEvent) {
  const field =
    event.type === 'account.deleted'
      ? { name: 'Account ID', value: sanitizeForDiscord(event.accountId), inline: true }
      : { name: 'Account', value: sanitizeForDiscord(event.email), inline: true };

  return {
    title: EVENT_TITLES[event.type],
    color: EVENT_COLORS[event.type],
    fields: [field],
    timestamp: new Date().toISOString(),
  };
}

export function createDiscordNotificationProvider(): NotificationProvider {
  const webhookUrl = process.env.NOTIFY_WEBHOOK_URL;
  if (!webhookUrl) {
    // Unreachable via getNotificationProvider() (lib/notify/index.ts only
    // constructs this provider when the var is already confirmed set) -
    // defense in depth, not a real runtime path, same posture as
    // resend-provider.ts's identical RESEND_API_KEY check.
    throw new Error('Missing required environment variable: NOTIFY_WEBHOOK_URL');
  }

  return {
    async notify(event) {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [buildEmbed(event)],
          // Adversarial review finding: defense in depth alongside the
          // escaping above, not a substitute for it - suppresses any
          // real @everyone/@here/role/user ping even if a future change
          // to the escaping logic ever missed a case.
          allowed_mentions: { parse: [] },
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Discord webhook responded with ${res.status}: ${body}`);
      }
    },
  };
}
