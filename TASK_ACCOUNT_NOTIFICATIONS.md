# Task scope: operator notifications for account/session events

Status: Built and confirmed live. The operator reported receiving real
Discord messages for all four events (`account.created`,
`account.deleted`, login, logout) on 2026-09-23, closing the "pending
a real Discord webhook smoke test" gap this status line previously
carried. Authorized and implemented 2026-09-15. One real deviation
from this doc, found during
implementation: every `lib/notify/*` path below actually lives at
`lib/notifications/*` instead - `lib/notify.ts` already existed in this
repo (an unrelated, pre-existing Mantine-toast helper used across several
components), and it silently won module resolution over a same-named
directory's `index.ts`, which is why every `getNotificationProvider`
import failed to resolve until this was caught by `tsc --noEmit`. Every
other design decision in this document was implemented as scoped,
including all three adversarial-review corrections (Discord markdown
escaping + `allowed_mentions`, the `!res.ok` throw, and the corrected
`account.created` call site).

**Revision note**: second draft. An adversarial review (a separate Opus
pass with real tool access, instructed to verify every claim against
actual code) found the first draft's central design sound but three real
defects in it: a genuine injection vulnerability the draft's own
non-goals explicitly (and wrongly) ruled out fixing, a failure-handling
claim that doesn't hold for how `fetch` actually behaves, and a call site
cited at a line that sits inside the wrong `try`/`catch`, which would
misattribute a notification failure as a signup failure. Corrected below,
not patched around. Two smaller claims (self-hosted admin username being
"non-secret"; a false ordering justification for the logout fix) are also
corrected.

## What this is

An optional, off-by-default notifier that fires a webhook on four events -
`account.created`, `account.deleted`, `login`, `logout` - so an operator
(Casazium, for the hosted SaaS resource, or a self-hosted Tier A/B
customer running their own copy of this console) can get a real-time push
notification instead of having to go looking. Decided in conversation with
the operator, not yet built:

- **Transport: a Discord-shaped webhook.** One env var pointing at a
  webhook URL the operator controls - Discord, chosen for its zero-setup
  native iOS/macOS apps, but the payload format (an `embeds` array) is
  Discord's actual webhook schema, not a generic shape that happens to
  also work there.
- **Interface pattern: mirrors this repo's own `EmailProvider`**
  (`lib/email/provider.ts`/`index.ts`/`stub-provider.ts`/
  `resend-provider.ts`) - which itself mirrors `casazium/license`'s
  `BillingProvider`. Same shape: a typed interface, a no-op stub as the
  unconfigured default, a real implementation selected by one env var,
  zero caller-side changes either way.
- **All four events, every deployment mode** - but self-hosted (Tier A/B,
  `MULTI_TENANT` unset) structurally only ever emits two of the four.
  There is no self-hosted "account" to create or delete - `verifyCredentials()`
  (`lib/auth.ts:64-94`) documents this directly: self-hosted is "a single
  shared admin username/password... not real multi-account," and
  `deleteAccountAction` (`app/(app)/settings/actions.ts:74-82`) throws if
  called without a resolved tenant, reachable only because the
  delete-account UI itself never renders outside `MULTI_TENANT`. So a
  self-hosted deployment only ever notifies on `login`/`logout`, using the
  configured `ADMIN_UI_USERNAME` as the identity - not a gap to build
  around, just what the mode actually has.
- **PII decision, made in conversation:** `account.created`/`login`/
  `logout` carry the real email (or, self-hosted, the admin username).
  `account.deleted` carries only the opaque account ID. This is not a
  general PII-minimization stance - it's a specific fix for a specific
  conflict: Casazium's own Privacy Policy promises a deleted hosted
  account "is permanently deleted from the service immediately and cannot
  be recovered," with backups aging out within 14 days. Discord does not
  expire messages - a plaintext email in a permanent `account.deleted`
  notification would outlive that promise indefinitely. This constraint is
  specific to Casazium's own SaaS resource; a self-hosted operator's own
  Discord receiving their own data has no such external promise to
  conflict with, but the code has no way to distinguish "Casazium's SaaS
  resource" from "a customer's self-hosted one" other than `isMultiTenant()`
  - which both use - so the masking applies uniformly rather than trying
  to special-case Casazium's own deployment.

## Corrected: attacker-controlled text must be escaped before it reaches Discord

The first draft's non-goals section explicitly ruled out any escaping
beyond the `account.deleted` masking above - wrong. `account.created`
fires with the signup-supplied email, and `/api/signup` is unauthenticated
and self-service. Its only validation is
`EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/` (`app/api/signup/route.ts:13`,
applied at `:104`) - which rejects whitespace and a second `@` and
nothing else. A string like `a[x](https://evil.example)@b.co` is a
*valid* signup email under that regex. Discord renders `[text](url)`
masked links, `||spoilers||`, backticks, and other markdown inside embed
`title`/`description`/field values - so an attacker can inject formatted,
clickable phishing content directly into the operator's own Discord
channel, rate-limited only by signup's existing per-IP attempt cap, not
blocked.

This repo has already fixed the identical bug class once:
`lib/email/resend-provider.ts:19-26`'s `escapeHtml()` exists specifically
because "`EMAIL_RE`... only rejects whitespace and stray '@' characters...
this is a real, not hypothetical, gap without escaping" - the exact
finding, reapplied here to a different rendering target. **Corrected
scope**: `discord-provider.ts` must escape Discord's markdown special
characters (at minimum `` * _ ` ~ | \ `` and Discord's own link syntax)
in any field carrying user-supplied text, and every outgoing payload sets
`allowed_mentions: { parse: [] }` so an injected `@everyone`/role mention
can't page anyone even if escaping is ever incomplete - defense in depth,
not a substitute for the escaping itself.

## Corrected: failure handling must actually detect a failed send

The first draft claimed the same `.catch(err => console.error(...))`
pattern `forgot-password/route.ts` already uses for its own email send -
true as a pattern, but that pattern only works because the email provider
explicitly throws on a bad response (`resend-provider.ts:71-74`,
`if (!res.ok) throw ...`). The first draft's own spec for
`discord-provider.ts` said only "plain `fetch` POST," and plain `fetch`
**does not reject on HTTP error status codes** - only on network-level
failure. Implemented as originally specified, a Discord **429** (real,
documented rate limit - roughly 30 messages/minute per webhook, bursts of
5 in 2 seconds), a **401** (revoked webhook token), or a **404** (deleted
webhook) would all resolve normally and be silently swallowed by the
`.catch` - worse than doing nothing, since it looks like working
delivery. **Corrected scope**: `discord-provider.ts`'s `send()` must
mirror `resend-provider.ts`'s own `if (!res.ok) throw new Error(...)`
exactly. Recommended (not required): log 401/404 distinctly from a
transient 429/5xx, since the former means the webhook is permanently dead
and needs the operator to generate a new one, not just a retry.

## Corrected: the `account.created` call site

The first draft cited "~line 194" - the `INSERT INTO accounts` statement
itself, which sits *inside* a `try` block whose `catch`
(`app/api/signup/route.ts:195-207`) reports a *different* failure
("Account insert failed after provisioning tenant ... tenant is now
orphaned") and returns `409`. A throwing notify call placed there would
be misattributed as an insert failure, incorrectly failing a signup that
actually succeeded. **Corrected call site**: after that `catch` resolves
and the `try` block exits cleanly - i.e. between line 207 and the
best-effort confirmation-email block that starts at `:215` - not inside
either try/catch, its own independent fire-and-forget call.

## Verified call sites (real file:line, not inferred; corrected per above)

1. **`account.created`** - `app/api/signup/route.ts`, after the
   `INSERT INTO accounts` try/catch fully resolves (after `:207`, before
   the confirmation-email block at `:215`) - its own independent
   statement, not nested inside either surrounding try/catch. Fires with
   the account's real (normalized) email, escaped per the correction
   above. Best-effort, same as the confirmation email beside it - a
   failed notification must not fail signup.
2. **`account.deleted`** - `app/(app)/settings/actions.ts`'s
   `deleteAccountAction`, after `deleteLocalRows()` commits (~line 107)
   and before `redirect('/login')` (~line 112). Verified safe ordering:
   `deleteAccountOnServer` (`lib/license-client.live.ts:550-560`) awaits a
   real `DELETE` request that throws on a non-2xx response, so by the
   time `deleteLocalRows()` runs, both the license-server-side and local
   deletions have already committed - no risk of notifying on a deletion
   that only partly succeeded, and no double-fire. Fires with
   `identity.id` only (the opaque account ID) - never `getAccountEmail()`,
   per the PII decision above.
3. **`login`** - `app/api/login/route.ts`, after `createSessionToken(identity)`
   (~line 191), i.e. only on an actual successful login, after every rate
   limit and the tenant-rejection probe have already passed - verified
   this introduces no new timing side-channel, since it sits after every
   early-return `401` in the function and the success path already makes
   a remote call (`getBillingStatus`) regardless. SaaS: real email via
   `getAccountEmail(identity.id)`. Self-hosted: `identity.id` itself
   (`lib/auth.ts:93`, which is literally `ADMIN_UI_USERNAME`, not an
   email).
4. **`logout`** - `app/api/logout/route.ts`. Verified nuance: session
   revocation there is gated `if (isMultiTenant())` (self-hosted has no
   accounts row to revoke), but the *notification* must not be gated the
   same way, since self-hosted is one of the two modes this task exists
   to support for logout specifically. Needs `getSession()` called
   unconditionally (both modes), and - for SaaS specifically - a
   `getAccountEmail(session.id)` lookup to get the same real-email
   treatment `login` gets (the first draft never specified this; `session.id`
   alone is an opaque account id, not the email the PII rule promises for
   this event). **Corrected justification**: the first draft claimed this
   must happen "before the cookie is deleted" as if there were a real
   ordering race - there isn't. The route deletes the cookie on the
   *response* object (`response.cookies.delete`, `:43`), not a
   request-scoped store, so `getSession()` can run any time before the
   function returns. The real reason to call it unconditionally is
   simply that it's currently only called inside the `isMultiTenant()`
   branch at all (`:35-40`) and self-hosted needs it too - not an
   ordering constraint. Verified safe for self-hosted: a `selfhosted`-mode
   token needs no DB lookup (`lib/session.ts:121-127,182`), `getSession()`
   never throws (all failure paths caught, `:185-187`), and a `null`
   return still lets cookie deletion proceed unaffected.

## New files (mirroring `lib/email/`'s exact structure)

- `lib/notifications/provider.ts` - the `NotificationProvider` interface:
  `notify(event: NotificationEvent): Promise<void>`, where
  `NotificationEvent` is a discriminated union over the four event names,
  each carrying only the fields that event actually has (no shared
  "identity" shape that's real for three events and awkwardly empty for
  the fourth).
- `lib/notifications/stub-provider.ts` - no-op, matching `stub-provider.ts`'s own
  minimalism (logs at most, sends nothing).
- `lib/notifications/discord-provider.ts` - plain `fetch` POST to the configured
  webhook URL, Discord's `embeds` schema, color-coded per event type. No
  SDK dependency, matching `resend-provider.ts`'s own "one endpoint, one
  call shape" reasoning. Must escape user-supplied text and set
  `allowed_mentions: { parse: [] }` (see correction above), and must
  throw on a non-2xx response the same way `resend-provider.ts` does (see
  correction above) - both now required parts of this file's spec, not
  implementation details left to chance.
- `lib/notifications/index.ts` - `getNotificationProvider()`, selecting the stub
  (default, whenever `NOTIFY_WEBHOOK_URL` is unset) or the Discord
  provider (whenever it's set) - deliberately **no** fail-loud-in-production
  check the way `EMAIL_PROVIDER` has one. That check exists because a
  silently broken password reset breaks a core account-recovery path a
  user depends on; a silently-off ops notification breaks nothing the
  product promises anyone - "optional" was explicit in the request, so
  unset must stay a quiet no-op forever, never an error.

## Config

- `NOTIFY_WEBHOOK_URL` - optional, unset by default. When set, must be a
  real `https://` URL (format-checked the same way
  `validateConsoleBillingUrl` in `casazium/license`'s `config.js` checks
  `CONSOLE_BILLING_URL` - protocol only, not reachability).
- No other new env vars, and no `NOTIFY_PROVIDER`-style selector - the
  first draft mentioned one in passing while also saying "no other new
  env vars," an internal inconsistency. Selection is purely
  presence-of-URL, matching `BILLING_PROVIDER`'s explicit-value pattern
  less than it matches "is a webhook configured at all" - closer to how
  optional destinations work elsewhere in this codebase than to a
  multi-provider enum. If a second transport (Slack, generic JSON,
  ntfy.sh) is ever added, that's the point at which an explicit selector
  becomes necessary - not before.

## Failure handling

Every call site fires the notification best-effort, fire-and-forget - a
Discord outage, a revoked webhook, or a malformed URL must never fail a
signup, deletion, login, or logout. Verified this is actually safe in
this app's real deployment shape (a real risk in general for
fire-and-forget async work in Next.js): `next.config.mjs` uses
`output: 'standalone'` and the Dockerfile's `CMD` runs `node server.js` -
a long-running Node process, not a serverless/edge function that can be
frozen or torn down the instant a response is sent. The well-known
"unawaited work never completes" gotcha for Next.js Route Handlers on
serverless targets does not apply here. This is consistent with the
"optional" framing throughout: the feature existing and failing silently
(now with the failure at least logged, per the correction above) is an
acceptable, expected steady state for anyone who hasn't set it up (the
stub) and a rare, non-blocking degradation for anyone who has (a broken
real webhook).

## Explicit non-goals for this task

- No per-event-type toggle (all four or none) - the operator asked for
  all four; a filter is a real but separate follow-up if wanted later.
- No retry/queue for a failed notification delivery - fire-and-forget,
  matching the email provider's own posture for the same class of
  best-effort send. A failure is now at least logged (see correction
  above) - logged-and-dropped, not logged-and-retried.
- No Slack/ntfy.sh/generic-webhook provider - Discord only, per the
  operator's explicit choice. The interface is provider-agnostic by
  design (same reasoning as `EmailProvider`), so adding one later is a
  new file, not a rewrite.
- No masking/redaction logic beyond the one `account.deleted` case
  decided above - `account.created`/`login`/`logout` show real
  identifying info by design (now escaped for safe rendering, not
  redacted), not oversight.

## Known, accepted risks - named rather than silently left out

- **Self-hosted `logout` never revokes anything** (`app/api/logout/route.ts:35`
  gates revocation to `isMultiTenant()` only, unchanged by this task) - a
  single valid self-hosted session cookie can be replayed indefinitely,
  and under this task each replay fires a notification. Same-origin-gated
  and requires a valid, already-authenticated cookie, so low severity on
  its own, but it is an unbounded-notification path that could plausibly
  trip Discord's own rate limit under repeated replay - the corrected
  failure handling above at least makes that visible (a logged 429)
  instead of silent.
- **This is an activity feed, not a security-alerting feature.**
  Notifications fire only on *successful* logins - a failed brute-force
  attempt, however large, produces no Discord activity at all. Worth
  stating plainly so nobody later assumes silence in this channel means
  no attack is happening.
- **A local-side failure after the remote deletion succeeds produces no
  notification.** If `deleteLocalRows()` (`settings/actions.ts:98-106`)
  were to throw after `deleteAccountOnServer` has already succeeded, the
  tenant is genuinely gone but `account.deleted` never fires - a
  pre-existing gap in the deletion flow's own error handling that this
  task inherits rather than introduces or fixes.

## Open questions for the operator

1. **Self-hosted login identity**: the first draft called
   `ADMIN_UI_USERNAME` "non-secret" - corrected, that's not quite right.
   It's compared with `constantTimeEquals()` (`lib/auth.ts:87`)
   specifically to prevent timing-based discovery, and
   `docker-compose-coolify.yml` groups it with `SESSION_SECRET`/
   `ADMIN_UI_PASSWORD` as "not committed anywhere." It's better described
   as *less sensitive than the password* (the password is never printed
   anywhere; `DEPLOYMENT.md:119` does echo the username plainly) than as
   genuinely public. Publishing it to Discord narrows self-hosted login
   to effectively a password-only secret. Probably still acceptable for
   an operator's own private notification channel - but confirm with
   this corrected framing, not the original's overstated one.
2. **Rate/volume**: `login`/`logout` could fire often on an active
   SaaS resource with many tenants - confirm a Discord channel receiving
   every single login across every tenant, all the time, is actually the
   desired signal (vs., say, only `account.created`/`account.deleted`
   being the two that matter most day to day). Not resolved here since
   the operator asked for all four explicitly - flagged in case that
   changes once it's live and noisy.

## What done looks like

- `lib/notifications/provider.ts`, `stub-provider.ts`, `discord-provider.ts`,
  `index.ts` built per the above - including markdown escaping,
  `allowed_mentions: { parse: [] }`, and a real `if (!res.ok) throw` in
  the Discord provider's send function.
- All four call sites wired at their corrected locations, including the
  `account.created` call moved outside both surrounding try/catch blocks,
  and the `logout` route's unconditional `getSession()` call plus its own
  `getAccountEmail()` lookup for the SaaS case.
- `.env.example` documents `NOTIFY_WEBHOOK_URL`.
- `DEPLOYMENT.md` gains a short section: what it does, that it's off by
  default, how to get a Discord webhook URL, the PII scoping decision
  (which events show email vs. an opaque ID, and why), and the two named
  risks above (self-hosted replay, activity-feed-not-alerting).
- Manual verification: a real Discord webhook receiving all four event
  types, correctly formatted, in both `MULTI_TENANT` and self-hosted
  modes - plus a deliberate test of a malformed/deleted webhook URL to
  confirm the corrected failure handling actually logs rather than
  silently swallowing it.
