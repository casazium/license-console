// lib/notify/provider.ts
//
// The NotificationProvider interface (TASK_ACCOUNT_NOTIFICATIONS.md),
// mirroring this repo's own lib/email/provider.ts pattern (itself
// mirroring casazium/license's BillingProvider): no runtime logic here,
// just the shape every implementation matches, selected via config
// (lib/notify/index.ts) with zero caller changes. A stub (no-op) default
// plus a real implementation (Discord) behind the same interface, so this
// is genuinely optional - nothing changes for anyone who doesn't
// configure it, self-hosted included.
//
// Every implementation is a factory: createXNotificationProvider() =>
// NotificationProvider, matching the email/billing providers' own
// dependency-injection-friendly shape.

/**
 * One of the four events this task covers. Each variant carries only the
 * fields that event actually has - no shared "identity" shape that's
 * real for three of them and awkwardly empty for the fourth.
 *
 * `email` on `account.created`/`login`/`logout` is a plain display
 * string already resolved by the caller - the real account email under
 * MULTI_TENANT, or the configured ADMIN_UI_USERNAME in self-hosted mode
 * (see lib/auth.ts's own doc comment on why self-hosted's "identity" is
 * that username, not an email). The provider implementation never looks
 * anything up itself, same "provider doesn't know about tokens or
 * accounts" posture as EmailProvider.
 *
 * `account.deleted` deliberately carries only `accountId`, never an
 * email - see TASK_ACCOUNT_NOTIFICATIONS.md's PII section for why: a
 * plaintext email in a permanent Discord message would outlive this
 * app's own "permanently deleted, cannot be recovered" promise for
 * hosted accounts.
 */
export type NotificationEvent =
  | { type: 'account.created'; email: string }
  | { type: 'account.deleted'; accountId: string }
  | { type: 'login'; email: string }
  | { type: 'logout'; email: string };

export interface NotificationProvider {
  /**
   * Delivers one event. Every real call site invokes this fire-and-forget
   * (`.catch(err => console.error(...))`, never awaited on the
   * request's own success path) - a notification failure must never fail
   * the signup/deletion/login/logout it's reporting on. Implementations
   * must reject (not silently resolve) on a real delivery failure, so
   * that `.catch` actually has something to catch - see
   * discord-provider.ts's own comment on why a plain `fetch` needs an
   * explicit `!res.ok` check to make this true.
   */
  notify(event: NotificationEvent): Promise<void>;
}
