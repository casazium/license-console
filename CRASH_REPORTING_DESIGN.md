# Crash Reporting: the hosted Console's reporter (faultline phase 1b)

Status: **Design, reviewed three times and revised; ready to build.** Written
2026-10-14 against `main` at `d6eb550` (1.6.4) and rebased on `4d5e767`
(#71, Paddle webhooks, merged 2026-10-14), with Next.js 16.2.12; file
references are to `4d5e767`. The proposal is RECOMMENDATION.

**Revised 2026-10-14 after an independent review** (`faultline`'s
reports, "console crash reporting design review.md"). The review built
the Console with Turbopack, ran the standalone server, and settled the
four open questions (§12). Three of them overturned assumptions in the
first draft, so its findings are folded in throughout and summarised in
§15. It found 4 high, 5 medium and 11 low issues.

**Revised again 2026-10-15 after a re-review** ("console crash reporting
design re-review.md"). The re-review found 17 of the 20 fixed and 3
partly fixed, and found 1 high, 4 medium and 9 low new issues, again
checked in a built standalone server. They are folded in and summarised
in §16.

**Revised a third time 2026-10-15 after a focused review** of the changed
parts ("console crash reporting design focused review.md"): 11 of the 14
fixed and 3 partly fixed; no high findings, and 3 medium and 6 low new
issues, all fixed in the text (§17). The reviewer judged that the design
can be built without another full review once these are in.

The License Server's reporter (faultline phase 1a,
`casazium/license` `CRASH_REPORTING_DESIGN.md`, PRs #48-#50, #56, #58) is
built, reviewed, live-tested and reporting from production since
2026-10-14. This is its Console counterpart. It reuses 1a's decisions
where the two apps agree, and says where Next.js forces a difference.

---

## 1. Why

The hosted Console (`license-cloud.casazium.com`) fails silently today:
errors go to `console.error` in the container log, which nobody reads
until a customer writes in. Signup is the worst case: a failure there
(`app/api/signup/route.ts:203`, "tenant is now orphaned") loses a customer
and leaves a tenant behind, with no alert.

## 2. Scope

**In:** the hosted Console only, on the two deployed resources:
`license-cloud` (environment `saas`) and `license-test-cloud`
(`saas-test`). Server-side errors in the Next.js server process: request
errors, the sites that catch and log, the proxy, and process-level
errors.

**Out:**
- **Self-hosted Console.** It can't report until EULA §4 ("communicates
  only with the License Server instance") changes (faultline design §11
  item 5). Reporting needs `CRASH_REPORT_HOSTED=true`, which only the
  Coolify compose file sets and no self-hosted doc mentions.
- **Browser errors** (`'use client'` files such as `app/error.tsx`). Their
  server-side render error already reaches `onRequestError`.
- **`scripts/`:** backups (`backup-db.mjs:106`), expiry notices
  (`notify-expiring.mjs:259/285/304`) and restore drills
  (`restore-drill.mjs:123`) run as Coolify scheduled tasks, outside
  Next. A failed backup is the worst silent failure this deployment has,
  so it gets a **follow-up**: a small envelope sender those scripts
  import, built on `lib/crash-reporter.ts`'s envelope code. Until then,
  Coolify's own task-failure notification covers it.
- **`after()` callbacks:** Next only logs their errors. The Console
  doesn't use `after()`; a future use must report explicitly.
- `license.casazium.com` (a standalone Console) isn't deployed. Its
  environment value, `standalone`, stays valid for when it is.

## 3. What gets reported

| Source | From | `source` |
|---|---|---|
| Request errors | `onRequestError(err, req, ctx)` in `instrumentation.ts`: an error thrown in a render (including layouts and `generateMetadata`, which can fail while the page answers 200), a route handler or a server action | `response` |
| Caught errors | `reportError(err, label)` at the server-side sites that catch and carry on (§6), and in `proxy()` (§6.2) | `log` |
| Process errors | `uncaughtException` and `unhandledRejection` (§7) | `process` |

**Counted, not reported.** These are faults of the request, not of the
Console, so they're counted per route rather than opened as issues:
- a rejected tenant: exactly a `LicenseApiError` with status 403 and the
  message `'Unauthorized'`, the shape `isTenantRejected` already uses
  (`lib/errors.ts:69-71`; `markIfTenantRejected(err); throw err` in
  `licenses/actions.ts`, `dashboard/page.tsx` and others). **Every other
  401 or 403 is reported:** the License Server never sends 401 on the
  routes the Console calls, and a 403 such as `Subscription is not
  active`, or a Cloudflare or proxy `Forbidden` in front of the API (which
  would make every page answer 500), is a fault someone must see;
- `Error('Unauthorized')` from `requireSession()` (`lib/session.ts`), a
  revoked session;
- `Error('Invalid Server Actions request.')`, Next's own message for a
  cross-origin action POST. The re-review sent one with any `Next-Action`
  header to public `/login` and got a 500 with no session, so scanners
  can reach it;
- **Next's own body-decoding errors**, exactly `Failed to parse body as
  FormData.` and messages starting `Failed to find Server Action.`. Any
  multipart POST to a page is treated as a possible action, and Next
  decodes the body before any Console code runs
  (`server-action-request-meta.js:38-40`, `action-handler.js:713-747`).
  The focused review sent one to `/login` and `/signup` with no cookie,
  `Origin` or `Next-Action` header: both answered 500 and reached
  `onRequestError` as `routeType: "render"`.

These Next messages are pinned in the built-server test (§11), so a Next
upgrade that changes them fails CI instead of opening issues.

**Every other request error is reported**, including a rethrown
`LicenseApiError` 400 or 409. Next answers those with a **500** and
`(app)/error.tsx`'s "Something went wrong" (measured), so the customer
sees a broken page: the License Server rejecting something the Console's
form allowed is a Console fault. Every Console page and action that can
rethrow a `LicenseApiError` needs a session, so those can't be raised
anonymously. (Next's decoding errors can be, which is why they're
counted.) Their
message is the License Server's `body.error`, cleaned like any other
(§8).

This **differs from 1a**, which counts by its own reply's status (an
error logged while the reply is under 500, `error-reporter.js:316-318`).
In the Console the reply is a 500 either way, so the rule is by cause.

**The checks never use `instanceof`:**
- Each bundle has its own copy of `LicenseApiError` (§5). In the built
  server, `err instanceof LicenseApiError` was false in `onRequestError`,
  and the constructor name was minified to `t` or `b`.
- So they test `err?.name === 'LicenseApiError' && typeof err.status ===
  'number'` (`lib/errors.ts` sets `name` explicitly), and the message for
  the two plain `Error`s.
- `check-report-error.mjs` fails on `instanceof` against an app class in
  `lib/crash-reporter.ts` and `instrumentation.ts`.
- A unit test can't catch this, because vitest loads one copy. The
  built-server test (§11) checks a route, a render and an action.

**How counts are sent:** per route, as 1a sends them
(`error-reporter.js:322`, `:405`). Every 60 s, one event per route goes
out with `source: "log4xx"`, carrying the count in its weight. faultline
adds it to the route's counter and opens no issue
(`internal/web/ingest.go:231`). It accepts `log4xx` only from trusted
keys, which project 2 is. Next never calls
`onRequestError` for `notFound()`, `redirect()` or a handler that catches
its own error (§12), so those need nothing.

## 4. Settings and gating

Based on 1a's `reporterSettings`, with two more conditions and a
stricter environment rule:
- `CRASH_REPORT_HOSTED` is exactly `true`;
- `NODE_ENV` is `production`. `next dev` with production values in
  `.env.local` must not report as `saas`;
- `CRASH_REPORT_DSN` parses as 1a requires: `https://<32-hex key>@<host>/<numeric id>`,
  with `http://` allowed only for `localhost` and `127.0.0.1`, for the
  local test;
- `CRASH_REPORT_ENVIRONMENT` is one of `saas`, `saas-test`, `standalone`.
  This **differs from 1a**, which only pattern-checks the value and warns
  about unknown ones for casazium hosts (`error-reporter.js:72-83`). The
  Console is hosted-only, so a fixed set costs nothing;
- tests pass settings in explicitly, never from the environment.

**Boot lines,** as 1a:
- `crash reporting on (environment=…, release=…)` at warn when on;
- `crash reporting off: <reason>` when `CRASH_REPORT_HOSTED=true` but
  something else is wrong, never including the key;
- **nothing** when `CRASH_REPORT_HOSTED` is unset, so a self-hosted
  install never prints a line its docs don't explain.

A bad value never stops the Console.

**Release** is `<package.json version>+<first 7 of SOURCE_COMMIT>`, or
`+unknown`, read **at runtime**. `next.config.mjs`'s build-time `GIT_SHA`
is always `unknown` in Docker (`.git` is in `.dockerignore`). On both
deployed resources, Coolify 4.4.6's **"Source commit availability"**
(Advanced → Build) must be the build-time option: "Runtime only" leaves
`SOURCE_COMMIT` empty for Compose resources (confirmed on the License
Server resources, 2026-10-14). faultline's design §8 ("Coolify always
provides it at runtime") and 1a's docs ("Include Source Commit in
Build") are corrected to match (§13).

The same runtime read fixes the version stamp's "commit unknown" tooltip:
`getAppVersion().gitSha` (`lib/version.ts`) prefers `SOURCE_COMMIT` and
falls back to `GIT_SHA`.

## 5. One reporter per process

Turbopack gives each bundle its own copy of a `lib/` module. The review
saw four in one process: instrumentation, route handlers, the page and
action bundle, and the proxy. `globalThis` is shared. So
`lib/crash-reporter.ts` holds **no state in module scope**:
- `register()` creates the one reporter, when the gate passes, at
  `globalThis[Symbol.for('casazium.console.crashReporter')]`. This is the
  pattern of `lib/db.ts:215-218`.
- That object holds the settings, the queue, the dedupe windows, the
  pause and the in-flight send, **and the methods**, so every bundle runs
  the one copy of the code that `register()` loaded.
- `reportError` and `onRequestError` only look it up, and do nothing when
  it's absent.
- **Creation sits outside `register()`'s existing `try`.** That block
  reads the secret files and calls `getDb()`, and its `catch` calls
  `process.exit(1)`. The reporter is created after it, in its own
  `try`/`catch` that logs one line and carries on, so a reporter bug
  can't stop the Console (§4).
- **Creation is idempotent.** If the object exists, `register()` returns.
  Listeners and the interval are installed once, which covers a dev
  reload or a second call.
- **The interval is `unref`'d,** as 1a's (`error-reporter.js:211`). A
  ref'd one didn't block Next's exit in the built server, but it would
  keep a vitest worker alive.
- **Tests** get `__resetForTests()`, which clears the interval, removes
  the listeners and deletes the object.
- **Calls before `register()`** are no-ops. Next awaits instrumentation
  before serving, so none were seen.

One queue and one send in flight per process keeps 1a's one-in-flight
rule and faultline's per-IP limit.

## 6. The event

Only fields faultline keeps (its design §6) are sent:
- **`exception.values[0]`:**
  - `type`: **1a's rule** (`error-reporter.js:39-41, 358`): the error's
    `name` if it's a built-in (`Error`, `TypeError`, `RangeError`,
    `SyntaxError`, `ReferenceError`, `EvalError`, `URIError`,
    `AggregateError`), plus two names the code sets literally:
    `LicenseApiError` and `SqliteError` (from the unbundled native
    package). Anything else becomes `Error`. Bundled libraries' names are
    minified: jose's errors were named `h` and `rh` in the build, and a
    raw `name` would change with every deploy.
  - A thrown non-Error (a string reaches `onRequestError` with no `name`
    or `message`) is sent as type `Error` with the value
    `<non-Error: Kind>`. This **differs from 1a**, which sends a string
    reason masked: the Console doesn't know where a thrown string came
    from.
  - `value`: the error's message after cleaning (§8), never empty. A site
    with no error object (`signup/route.ts:162`) sends type `LogError`
    with its label as the value, as 1a does (`error-reporter.js:363-367`).
  - `stacktrace.frames`: parsed from `err.stack`, at most 50. File names
    lose `process.cwd() + '/'` (`server.js` does `process.chdir(__dirname)`),
    then `.next/server/`, so no machine path is sent or recorded in
    golden files. `in_app` is false under `node_modules`.
- **`tags`:**
  - `route`: `ctx.routePath` for request errors. For `reportError`, a
    **literal route passed by the site** (`reportError(err, label,
    route?)`), or `<no-route>` for shared code such as `lib/session.ts`,
    and `/proxy` for the proxy. Fire-and-forget `.catch` sites run after
    the response, so the route can't come from the request. The review found it is
    already the template, with groups removed and no suffix
    (`/rt/grp/[id]`, `/api/rt/all/[...slug]`; an action gives its page's
    route). One trailing `/page` or `/route` segment is stripped (a fixed
    suffix, not a rewrite): an error that escapes the page handler's outer
    `catch` carries the raw `srcPage`, such as `/login/page`
    (`app-page.js:1321-1324`, `:883-886`; `app-route.js:345`), measured
    for the §3 decoding errors. It's then validated against faultline's
    pattern, and sent as `<no-route>` if it fails. A test pins today's
    values, including `/login/page` → `/login`.
  - `method`: from `req.method`, the only field of `req` read.
  - `route_type` (`render`, `route`, `action`, and `proxy` for the proxy)
    and `router` (`app`).
  - `source` (§3), `logmessage` (the label, for `log`).
  - `error_code`: the error's `code`, or `err.cause.code` for
    `TypeError: fetch failed` (such as `ECONNREFUSED`), when it matches
    faultline's pattern, `^(SQLITE|ERR|FST|E)[A-Z0-9_]{0,60}$`
    (`event.go:67`). An unreachable License Server then groups by cause.
    undici's own codes (`UND_ERR_…`) don't match and are dropped; widening
    faultline's pattern is a later faultline change, not part of 1b.
- **`fingerprint`,** as 1a (faultline §7.1):
  - `[route, error_code || type, template(value)]` for `response` and
    `process` events;
  - `[route, "log", template(label), error_code || type]` for
    `reportError`. faultline's design suggests `[route, "log",
    template(label)]` (`docs/design.md:285`), but then every cause at
    one site (a Resend 422 and an `ECONNREFUSED` at `signup:226`) would
    merge into one issue. 1a's code uses `[route, code || type, value]`
    for every capture (`:380`); adding the cause to the label keeps a
    site's issues apart by cause while the label keeps them readable.

  The Console's in-app frames are minified Turbopack chunks
  (`chunks/ssr/[root-of-the-server]__1i_bjp0._.js`, functions `b`, `m`).
  Their names change on every deploy, so faultline's frame-based grouping
  would open a new issue for the same error after each release. Frames
  are diagnostics only.
- `release`, `environment`, `platform: "node"`, `sdk`
  (`casazium.console` and the app version), `level: "error"`, `event_id`,
  `timestamp`, and `extra.sample_weight` (§9).

**faultline project 2 (`license-console`) is trusted** (it is, in
`faultline.yaml`), so it honours `fingerprint` and `sample_weight` and
gets the trusted rate. The key goes in `X-Sentry-Auth`, as in 1a.

**Never sent:**
- `req.path` (it carries the query string) and `req.headers` (cookies
  included);
- the text written to `console.error` (it names account and tenant ids,
  for example `actions.ts:147`);
- session or account data, tenant ids, IP addresses.

There is no `request_id`: the Console's logs have none to match.
`build` doesn't apply.

### 6.1 Caught errors: `reportError`

`reportError(err, label, route?)` takes a **string literal** label, the
site's own description with no values, and a literal route (§6). It never awaits, never throws, and does
nothing when reporting is off.

The sites, as of `4d5e767` (both reviews confirmed the list is complete at `d6eb550`; #71 shifted `settings/actions.ts` by 5 lines):

| Site | Label | Route |
|---|---|---|
| `app/(app)/settings/actions.ts:152` | account.deleted notification failed | `/settings` |
| `app/(app)/settings/actions.ts:245` | rotated API key not persisted locally | `/settings` |
| `app/(app)/settings/actions.ts:355, 372, 392, 410, 428, 450, 490` | storefront webhook action failed (§6.3) | `/settings` |
| `app/api/signup/route.ts:162` | signup unavailable: License Server settings unset | `/api/signup` |
| `app/api/signup/route.ts:183` | tenant provisioning failed during signup | `/api/signup` |
| `app/api/signup/route.ts:203` | account insert failed after provisioning: tenant orphaned | `/api/signup` |
| `app/api/signup/route.ts:226` | signup confirmation email failed | `/api/signup` |
| `app/api/signup/route.ts:241` | account.created notification failed | `/api/signup` |
| `app/api/health/db/route.ts:27` | health check: database query failed | `/api/health/db` |
| `app/api/change-email/route.ts:120` | email-change confirmation failed | `/api/change-email` |
| `app/api/logout/route.ts:58` | logout notification failed | `/api/logout` |
| `app/api/verify-email/route.ts:93` | email-change redeem failed | `/api/verify-email` |
| `app/api/verify-email/route.ts:106` | email-change notice to old address failed | `/api/verify-email` |
| `app/api/verify-email/resend/route.ts:73` | signup confirmation resend failed | `/api/verify-email/resend` |
| `app/api/forgot-password/route.ts:109` | password reset email failed | `/api/forgot-password` |
| `app/api/forgot-password/route.ts:112` | password reset preparation failed | `/api/forgot-password` |
| `app/api/login/route.ts:206` | login notification failed | `/api/login` |
| `lib/session.ts` (the account lookup inside `verifySessionToken`) | session lookup failed (§6.3) | `<no-route>` |
| `instrumentation.ts` `register()` | not reported: a startup failure exits before reporting is on, and the container log has it | — |

watchdog polls `/api/health/db`, so a database outage reports on every
poll. Dedupe (§9) folds that into one event per 10 s, and faultline into
one issue with a count, which is the right outcome.

### 6.2 The proxy

In Next 16, `proxy.ts` runs on **Node.js**, not Edge (Next's own proxy
docs, line 223; the built manifest says `runtime: nodejs`). But its
errors reach no `onRequestError`: Next's proxy wrapper looks for an
Edge-only instrumentation module. So `proxy()`'s body is wrapped in
`try`/`catch`, which calls `reportError(err, 'proxy failed')` with route
`/proxy` and rethrows. That's possible because the proxy shares
`globalThis` (§5). It's sent with `route_type: proxy`, which faultline
accepts (`event.go:74`). The rethrow keeps today's 500 (measured), and
dedupe bounds a proxy failing on every request.

The `instrumentation.ts` header comment ("Edge for proxy.ts's
middleware") is corrected, and so is faultline's design (§13).

### 6.3 Errors that are swallowed today

**The seven storefront actions** in `settings/actions.ts` (#71 added two):
- `createStorefrontWebhook`, `setStorefrontWebhookSecret`,
  `setStorefrontWebhookApiKey`, `sendStorefrontPendingDeliveries`,
  `setStorefrontRefundPolicy`, `setStorefrontSubscriptionGrace`,
  `createStorefrontMapping`;
- each turns any `Error` into `{reason: 'validation', message:
  err.message}`, with no log.

The rule:
- **A `LicenseApiError`** (checked by `name`, §3) **keeps today's
  behaviour:** its message is shown as is, and nothing is reported. The
  message is the License Server's `body.error`, written for the user. That
  includes #71's Paddle errors: `setStorefrontWebhookApiKey`
  (`lib/license-client.live.ts:856-859`) throws a `LicenseApiError` with
  status 502 ("Paddle unreachable") or 503 ("rate limited") whose
  comment says it carries "a message to show as-is". Paddle being down is
  not a Console fault, so it is not reported.
- **Validation errors become `LicenseApiError`s first,** so the rule
  doesn't take a tenant's typo for a fault:
  - `createStorefrontMapping` throws `new Error('Limits must be valid
    JSON')` (`license-client.live.ts:1003`) when the limits text doesn't
    parse, and nothing validates the field first
    (`StorefrontWebhookMappings.tsx:126`). It becomes
    `LicenseApiError('Limits must be valid JSON', 400)`.
  - The mock client (standalone and demo installs) throws plain `Error`s
    for every storefront validation message (`license-client.mock.ts:881,
    919, 924, 940, 945, 959, 1019, 1036`). They become `LicenseApiError`s
    with the status the live server would send (400 or 409), so mock and
    live classify alike. Without this, every demo install would show a
    misleading network message, whether or not reporting is on.
- **Any other error** is a fault (a network failure, a bug):
  - it is reported, with the label `storefront webhook action failed`
    and the action's page route;
  - the user sees `Couldn't reach the License Server - try again`
    instead of the raw message.
- **A `LicenseApiError` with status 500 or more is reported too**, but
  still shows its message. A 502, 503 or 504 from Traefik or Cloudflare
  when the License Server is down arrives as
  `LicenseApiError("Failed to …: 502 Bad Gateway", 502)` (`live.ts:166`),
  and 1a, being down, can't report it. The exception is the API-key
  call's own Paddle answers: PR B makes `setStorefrontWebhookApiKey`
  (`live.ts:856-859`) set `display: true` on a 502/503 that carries the
  License Server's `body.error`, and those aren't reported. The check
  reads the property, not the class (§3). A
  proxy 502/503 on that call has no `body.error`, so it is reported;
  today it shows "Couldn't check the key with Paddle - try again", which
  blames Paddle, and that existing #71 message is left as it is.

That user-visible change (a generic message for a non-`LicenseApiError`)
is small and is listed in PR B. Tests cover:
- a 502 with `display: true` from the API-key action: the message is
  shown, and nothing is reported;
- a proxy 502 on another action: the message is shown, and one report;
- a malformed limits string, in live and mock mode: its message is shown,
  and nothing is reported.

**`lib/session.ts`'s `verifySessionToken`** has one `try` from `:89`
(`jwtVerify`) to the `catch { return null; }` at `:185`. So the catch
takes every jose failure as well as database errors. It runs on every
protected request (`proxy.ts:81`), and twice on every page through the
root layout's `getSession()`, including public `/login`. In the built
server, a junk cookie on `/login` hit the catch twice per request.
Reporting the whole catch would open an issue on day one that anyone can
keep raising, and a real database failure would fold into it without an
alert. So the `try` is split:
- **`jwtVerify` failures** (an expired token, a bad signature, a
  malformed cookie, a `SESSION_SECRET` rotation) still return `null`
  silently;
- **the account lookup** (`getDb().prepare(...).get`) and
  **`getSecretKey()`** (a missing or short `SESSION_SECRET`, a real
  misconfiguration) report with the label `session lookup failed` and
  route `<no-route>`, and still return `null`;
- tests check that a junk cookie reports nothing, and that a throwing
  database reports once.

**`app/(app)/settings/page.tsx:83`** silently shows storefront webhooks
as "unavailable". It's left as is: the page says so, and the actions
behind it are covered above.

## 7. Process errors

Next's standalone server installs its own `uncaughtException` and
`unhandledRejection` listeners. They log the error and **keep
serving**, on purpose (`process-error-handlers.js:16-58`: "we definitely
shouldn't crash the entire process"). The review confirmed that
`/api/health/db` answered 200 after both.

The reporter keeps that behaviour:
- It adds a listener for each event that **only reports**
  (`source: process`). There is no exit, no timer and no stderr write,
  since Next already logs them.
- They go through the normal queue and dedupe. 1a sends crash events
  directly because its process is about to die; here nothing is.
- Rejections whose reason is a React postpone are ignored, as Next
  ignores them (`isPostpone`).
- Next's rejection filter patches `process.on`, so the listener is
  registered normally and receives what Next passes on. The re-review
  confirmed both listeners fire once each and the process keeps serving.
- **Neither listener may throw.** Each wraps everything in `try`/`catch`.
  In the built server a throwing `unhandledRejection` listener made
  Next's filter skip the later listeners, so Next's own `⨯
  unhandledRejection` log line was lost, and the throw came back as an
  `uncaughtException` (`unhandled-rejection.external.js:479-500`). Ours
  is registered first, so the order matters. A throw inside an
  `uncaughtException` listener is fatal in Node (exit 7).
- **The code lives in `lib/crash-reporter.ts`,** loaded by the existing
  dynamic import after the `NEXT_RUNTIME` check. Each `process.on`
  written directly in `instrumentation.ts` adds a Turbopack Edge warning
  (four were measured), and none appear behind the dynamic import.

**Decision (§14.5):** the Console keeps Next's survive-and-log semantics.
Crashing on purpose would be a product decision to state, not a side
effect of reporting. (1a crashes because Fastify's default does.)

## 8. Cleaning

Every message is cleaned before it leaves the process with **both of 1a's
layers, ported to TypeScript**:
1. **`error-reporter.js`'s `cleanValue`** (`:425-468`), with
   `replaceQuoted`, `QUOTE_PAIRS`, `SHORT_NAME`, the `SyntaxError` rule
   and the 4× cut. It replaces every quoted span with `<q>` (all of them
   in a `SyntaxError`) and Stripe ids with `<stripe-id>`. It loops each
   value until it stops changing (`stable`).
2. **`error-mask.js`'s masks,** in the same order. `template` comes with
   them, for the fingerprint.

Together they are `lib/error-mask.ts`. The review showed why both are
needed: a malformed action body gave `SyntaxError: Unexpected token 'I',
"Ignore thi"... is not valid JSON`, which quotes the request body. The
masks alone leave the quote intact; `cleanValue` replaces it.

**Messages fixed at the source,** as 1a did with its `email.js:88`:
- `lib/email/resend-provider.ts:73` (``Resend API responded with
  ${res.status}: ${body}``);
- `lib/notifications/discord-provider.ts:101`.

Both embed the remote service's response body. The status stays in the
message, and the body goes only to the local log.

**The source check,** `scripts/check-error-messages.mjs`, ports **1a's
full rule** (`check-error-messages.mjs:16-23`):
- **It fails** on any error constructed with a message that isn't fixed
  text: a variable, a concatenation, a template with a value, a call,
  another error's message, or `super(...)`. That covers `Error`,
  `LicenseApiError` and every other `*Error` class in `lib/` and `app/`.
- **The escape** is an `// error-message-ok: <reason>` comment on the
  line or the one above, for a status code, a setting's name or a count.
- **The parser:** 1a's checker uses acorn, which can't read TypeScript,
  so the port walks the `typescript` AST (already a devDependency).
- **Its scope:**
  - `lib/license-client.mock.ts` is **excluded**. It runs only in
    standalone and demo installs, which never report, and its templated
    messages (`:881, 919, 924, 940, 945, 959, 1019`; `:1019` quotes the
    user's `ref_kind`) are shown to that install's own user.
  - `lib/secret-files.ts` is **excluded** as boot-only (`:43, 49`: a file
    path, and another error's message), as 1a excludes its
    `BOOT_ONLY_FILES`. It runs before reporting is on.
- **What it flags today, about 17 sites,** each escaped or fixed in PR B:
  - `lib/license-client.live.ts:164`, `new LicenseApiError(body.error ||
    …)`. That text is the License Server's, written for the user and
    reported only under §3, so it gets an `error-message-ok` with that
    reason.
  - `:166`, `${fallbackMessage}: ${res.status} ${res.statusText}`: a
    status and a fixed text, also escaped.
  - #71's 502/503 path (`:856-859`), escaped as the License Server's
    text.
  - `:796`, `${label}` and `${minServerVersion}`: constants, escaped.
  - `lib/session.ts:54` and `lib/db.ts:168`: counts, escaped.
  - `lib/license-client.ts:78`: a setting's name, escaped.
  - `lib/email/index.ts:21, 57`: an environment value naming the email
    provider, escaped.
  - `app/api/signup/route.ts:179`: a status, escaped.
  - `lib/tenant-context.ts:22`, "No account found for id ${accountId}":
    **fixed**, because the id comes out of the message (it stays in the
    local log).

**The corpus:**
- The port is checked against faultline's `testdata/scrub-corpus.json`
  (787 cases in its `mask` array), vendored as
  `tests/fixtures/scrub-corpus.json`.
- A test fails if the vendored copy's hash differs from the one recorded
  beside it, so a corpus update is copied in deliberately.
- The "785" in faultline's design is corrected (§13).

The rules cover what the Console's errors can carry:
- emails (from Resend and `accounts` errors);
- JWTs (the session cookie);
- Stripe secrets and ids;
- Resend keys;
- license and tenant API keys;
- UUIDs (account and tenant ids are `crypto.randomUUID()`) and long hex
  values;
- IP addresses;
- quoted spans.

SQLite messages name columns, not values, and stay readable.

## 9. Sending and dedupe

No Sentry SDK; `fetch` builds the envelope. The rules are **1a's
`reporterSettings` and transport, copied exactly:**
- **Batching:** one send in flight; at most 50 events per batch; a
  500-event queue with an overflow counter.
- **Timing:** a 2 s timeout, and `redirect: 'error'`.
- **faultline's answers:**
  - `429`: read `X-Sentry-Rate-Limits` first, then `Retry-After`.
  - `403`/`404`: log one `crash reporting refused (HTTP …)` warning and
    pause for 10 minutes.
  - Other 4xx/5xx: drop the batch.
- **Drop line:** "N reports (M errors) dropped".
- **The refusal warning** is logged at most once an hour, as in 1a
  (`error-reporter.js:636`).

**Dedupe,** one mechanism for every source, as 1a: keyed on the §6
fingerprint (masked and templated, so values in a message don't defeat
it), in a 10 s window, the repeat count carried as `sample_weight`. The
cap is 200 fingerprints, after which 1a's `Overflow` event is sent.
Next's `digest` isn't used: route-handler errors don't have one, and it
hashes the raw message.

**Next's request-scoped `fetch`.** Next patches `fetch` with request
context (`server/lib/patch-fetch.js:220` and following). So sends never
start inside a request:
- `onRequestError` and `reportError` only enqueue;
- a **1-second interval started in `register()`** (outside any request)
  flushes the queue and the dedupe windows;
- sends pass `cache: 'no-store'`;
- a test checks that a render error's report raises no Next warning.

**What a redeploy loses.** On `SIGTERM`, Next's `cleanup` awaits
`server.close()`, then calls `process.exit(143)` straight away
(`start-server.js:322-391`). A listener can't delay that: the first
review's 1.5 s send never went out. `NEXT_MANUAL_SIG_HANDLE` would allow
it, but nothing would then close the server gracefully, which is worse.
So there's no shutdown flush, and a redeploy can lose:
- **queued reports:** up to about 1 s, the interval;
- **repeat counts:** up to 10 s, because a dedupe window releases its
  suppressed count 10 s after its first event (`flushWindows`,
  `error-reporter.js:544-557`). The first occurrence goes into the queue
  at once, so it's only lost if it arrived in the last second;
- **4xx counts:** up to 60 s (`:560-566`).

1a forces both on close (`flushFor`, `:791-792`); the Console can't.
A new error is only lost if it happened in the last second before the
stop; otherwise only counts are lost. `DEPLOYMENT.md` says so. (`scripts/start.sh` runs `node server.js` under
`litestream replicate -exec` when Litestream is on. The live test checks
that the Console still stops cleanly.)

**What the code mustn't contain:**
- **The faultline host:** a CI step scans what ships, `.next/standalone`
  and `.next/static`, excluding `*.map`, for `faultline.casazium.com` and
  the DSN shape after `npm run build`. Source maps and the build cache
  carry source comments, and a comment may name faultline.
- **Its own error text:** nothing in the reporter is sent as a message.
  Its failures go to the container log.

## 10. Compose and docs

- **`docker-compose-coolify.yml`** gains `CRASH_REPORT_DSN`,
  `CRASH_REPORT_ENVIRONMENT`, `CRASH_REPORT_HOSTED=true` and
  `SOURCE_COMMIT=${SOURCE_COMMIT}`, with a comment pointing here.
- **`docker-compose.selfhosted.yml`** and **`README.selfhosted.md`** don't
  change and don't mention reporting. `env_file: .env` forwards whatever
  an operator writes, so the safeguard is that reporting is off unless
  `CRASH_REPORT_HOSTED` is set, and no Casazium DSN is in the code (as
  1a §8.3).
- **`DEPLOYMENT.md`** gets a "Crash reporting" section like the License
  Server's. It covers:
  - what's sent and what never is;
  - the variables and the two deployed environments;
  - the Source commit setting;
  - the boot line;
  - that a redeploy can lose the last second's reports, up to 10 s of
    repeat counts and up to 60 s of 4xx counts;
  - the trigger (§11);
  - to turn it off, **delete** the variable and redeploy: an emptied
    value can stay in the container (1a §11.3);
  - the privacy gate.
- **casazium's `Privacy.tsx`:** the visible text needs no change. It
  already says "a hosted service", and §3 and §8 keep "no request
  contents … account identifiers" true. Its source comment (`:44-45`,
  "the console will in faultline's phase 1b; reword this then") is
  reworded in a casazium PR at go-live, before the production DSN. The
  rewording says the Console sends no `request_id`. The visible text's
  "a request ID that matches our own server logs" stays true of hosted
  services in general, but not of every report.

## 11. Testing

**Unit tests (vitest):**
- **Cleaning:**
  - the corpus, with the hash check;
  - `cleanValue` cases: the malformed-body `SyntaxError`, a Resend 422
    message, curly and angle quotes, Stripe ids.
- **Settings:**
  - the gating matrix, with the three boot-line cases;
  - no key in any log line;
  - `http://` allowed only for localhost.
- **The event:**
  - its shape against faultline's allowlist;
  - fingerprints;
  - `error_code` from `cause`;
  - a thrown string (`<non-Error: Kind>`) and a site with no error object (`LogError`);
  - path stripping;
  - pinned `routePath` values, and the `<no-route>` fallback.
- **Counted or reported (§3):** a `LicenseApiError` 401 or 403,
  `Unauthorized` and `Invalid Server Actions request.` are counted; a
  `LicenseApiError` 400, 409 or 503 and a `TypeError` are reported. The
  checks use `name`, never `instanceof` (a fixture builds an error with
  the right `name` from a different class).
- **Storefront actions (§6.3):** a `display: true` 502 from the API-key
  action shows Paddle's message and reports nothing; a proxy 502 shows
  its message and reports once; a `TypeError` shows the generic message
  and reports once; a malformed limits string, live and mock, shows its
  message and reports nothing.
- **The 403 shape (§3):** 403 `'Unauthorized'` is counted; 403
  `Forbidden` and 403 `Subscription is not active` are reported.
- **The route suffix:** `/login/page` → `/login`.
- **Session (§6.3):** a junk cookie reports nothing; a throwing database
  reports once.
- **The type rule:** a minified class name becomes `Error`; the
  built-ins, `LicenseApiError` and `SqliteError` pass.
- **Listeners:** a listener whose report fails doesn't throw.
- **Dedupe:** weights, the cap and `Overflow`.
- **Transport:** each of faultline's answers.
- **`reportError`:** with reporting off (no `fetch`), and with a literal
  label.
- **`onRequestError`:** a proxy object makes `req.path` and `req.headers`
  throw if read.

**Built standalone server, against a local faultline** (`npm run build`,
`node .next/standalone/server.js`, the DSN `http://<key>@127.0.0.1:<port>/2`).
The things only a real build shows:
- one queue: a route error, an action error, a `reportError` site, a
  proxy error and an unhandled rejection all arrive through one envelope
  stream;
- the §3 counts for a `LicenseApiError` 403 thrown from a route, a render
  and an action (the `instanceof` case only a build shows);
- a junk session cookie on `/login` reports nothing;
- the process still serves `/api/health/db` after an unhandled rejection
  and an uncaught exception;
- no event for `notFound()`, `redirect()` or a caught error;
- a count, but no issue, for a cross-origin action POST, and for an
  anonymous multipart POST to `/login` with a junk body and with a
  well-formed one. These pin the exact Next texts: `Invalid Server
  Actions request.`, `Failed to parse body as FormData.`, `Failed to find
  Server Action.`;
- the live trigger (§11 below: a session, a real action id, a junk
  multipart body) still reports `Unexpected end of form` with
  `routeType: action`, and isn't caught by the counted list;
- a malformed action body stored with no quoted text;
- a `generateMetadata` error reported even though the page answers 200;
- no Next warning from a send.

**In CI** (`test.yml`, on the existing self-hosted Mac runner with Node
22, where `better-sqlite3` builds; a warm Turbopack build took about
5 s):
- **The fixture routes must not ship.** A CI step copies the test
  fixtures into a temporary `app/(crash-test)/` in a scratch copy and
  runs a second build there. The image is built from the clean tree, and
  no route is gated by an environment variable.
- **faultline itself isn't built in Console CI** (it's a private Go
  repo). A small Node envelope recorder, in `tests/`, stands in for it.
  faultline's own golden test runs in faultline's repo, on the recorded
  envelopes.
- **Ports are chosen free at run time.** The same Mac hosts another
  runner.
- **`PUBLIC_BASE_URL` is set:** without it, public routes throw in a
  production build.
- **The fixtures throw `LicenseApiError`s directly,** because mock mode
  can't produce one naturally.

The recorded envelopes go into faultline's `testdata/envelopes/`
(`console-*.envelope`, with no machine paths), so faultline's golden test
covers the Console's real output.

**Live, on `license-test-cloud` (`saas-test`):**
1. The boot line.
2. While logged in, POST any page's action id with `Content-Type:
   multipart/form-data; boundary=zz` and the body `x`. The review saw
   `Error: Unexpected end of form`, `routeType: action`, a 500, no user
   text, and no data touched.
3. Check the stored event: no account id, email, path or quoted text.
4. Resolve the test issue.

No `reportError` site has a harmless trigger, so the live test settles
for `onRequestError`; the local test covers `reportError`. (Unsetting
`LICENSE_API_URL` to reach `:162` would break every page: `lib/license-client.ts:74-99`.)

## 12. Settled by the review (Next.js 16.2.12, Turbopack, standalone server)

1. **`ctx.routePath`** is the route template, with groups removed and no
   `/page` or `/route` suffix. Every value matched faultline's pattern
   (`app-page.js:179-188`, `app-route.js:140-149`). A
   `TODO: fix turbopack providing differing value from webpack` at
   `app-page.js:181` means a switch to `next build --webpack` re-checks
   this.
2. **Next installs its own handlers** for `uncaughtException` and
   `unhandledRejection` (log and keep serving), and for `SIGTERM` (close,
   then exit 143 at once). A listener can't delay that exit (§7, §9).
3. **Proxy errors reach no `onRequestError`,** and the proxy runs on
   Node.js (§6.2).
4. **A handler that catches its error and returns a response** triggers
   no `onRequestError`. Neither do `notFound()` and `redirect()`.

Also seen:
- each failing request makes exactly one call (no double report from
  RSC and SSR);
- render and action errors carry a `digest`, but route errors don't;
- malformed action bodies reach `onRequestError` as `routeType: action`
  **only with a `Next-Action` header**. Without one, a multipart POST to a
  page arrives as `routeType: "render"`, with route `/login/page` (the
  focused review).
- The Console's own actions all need a session, but **anonymous traffic
  can still reach `onRequestError`**:
  - a cross-origin POST with any `Next-Action` header to public `/login`
    gave `Invalid Server Actions request.`, a 500, with no session (the
    re-review);
  - a header-less multipart POST gave `Failed to parse body as FormData.`
    or `Failed to find Server Action. …` (the focused review).

  §3 counts all three.

## 13. Plan

Each PR is reviewed independently before merging, as in 1a.

| PR | Contents |
|---|---|
| A | `lib/error-mask.ts` (both layers, `template`, `stable`) with the vendored corpus; `lib/crash-reporter.ts` (settings, the `globalThis` reporter, the event, fingerprints, dedupe, the transport and its interval); `onRequestError` and the process listeners in `instrumentation.ts`, with its comment corrected; the `getAppVersion` change; unit tests. Reporting is reachable, but nothing sets the variables. |
| B | The `reportError` sites (§6.1), the proxy wrapper, the swallowed errors (§6.3: the storefront rule and its generic message, and the `verifySessionToken` split), the two provider messages, `check-report-error.mjs` and `check-error-messages.mjs` (with the `error-message-ok` escapes), the shipped-files scan in CI, the compose lines, the `DEPLOYMENT.md` section, the built-server test with its CI recipe (§11), and the golden envelopes (with a faultline commit). |
| D | An end-to-end review of A and B. |
| — | The live test on `license-test-cloud`; release Console 1.7.0 (minor: a new optional feature); the casazium privacy comment; then the production DSN on `license-cloud`. |

**`check-report-error.mjs`:**
- It walks the TypeScript AST of every file under `app/` and `lib/` that
  isn't `'use client'`.
- It fails when a `console.error` isn't followed in its block by
  `reportError` with a string-literal label, unless a
  `// report-error-ok: <reason>` comment covers it.
- It handles multi-line calls (`signup/route.ts:162`, `:203`).
- A second rule fails any `reportError` whose label or route isn't a
  literal.
- A third fails `instanceof` against an app class in
  `lib/crash-reporter.ts` and `instrumentation.ts` (§3).

**Corrections elsewhere, in the same PRs:**
- faultline's design:
  - §2/§7: the proxy is Node.js, and its errors don't reach
    `onRequestError`;
  - §8: Coolify's "Source commit availability";
  - "785" becomes 787.
- 1a's `DEPLOYMENT.md` `SOURCE_COMMIT` row: already handed to the License
  session for 1.11.0.

**Coordination:** `casazium/license-console#71` (Paddle webhooks, the
License session) merged on 2026-10-14 (`4d5e767`), and this design is
rebased on it. PR B edits `app/(app)/settings/actions.ts` and
`lib/license-client.live.ts`, which the License session also works in for
Paddle. Before PR B starts, check for any open Console PR touching those
files and agree the order with that session.

## 14. Decisions

1. **No Sentry SDK:** the License Server's reasons hold here. It adds
   breadth we'd have to scrub, and `fetch` is enough. RECOMMENDATION.
2. **Static labels, not log text,** because the Console's log lines name
   account ids. RECOMMENDATION.
3. **Both of 1a's cleaning layers, ported and held to faultline's
   corpus,** so the privacy page's one description stays true for both
   services. RECOMMENDATION.
4. **Hosted only, behind `CRASH_REPORT_HOSTED`,** until the self-hosted
   EULA allows otherwise. RECOMMENDATION.
5. **Keep Next's survive-and-log behaviour** for process errors: report,
   never exit. RECOMMENDATION.
6. **Counted by cause, not by status:** a rejected tenant, a revoked
   session and a cross-origin action POST are counted; every other
   request error is reported, including a rethrown 400 or 409, because the
   customer sees a 500. This differs from 1a, whose replies carry their
   own status. RECOMMENDATION.
7. **No shutdown flush;** a 1 s interval bounds the loss, instead of
   taking over Next's signal handling. RECOMMENDATION.

## 15. Review changes (2026-10-14)

| Finding | Change |
|---|---|
| H1: crash handlers would turn errors Next survives into restarts | Report only, never exit (§7, §14.5) |
| H2: one module copy per bundle splits the reporter's state | One reporter on `globalThis`, created in `register()` (§5) |
| H3: no client fingerprint, so minified frames regroup after every deploy | 1a's fingerprints; project 2 trusted (§6) |
| H4: quoted-span cleaning is in `error-reporter.js`, not `error-mask.js` | Both layers ported; the Resend and Discord messages fixed at source; `check-error-messages.mjs` (§8) |
| M1: a SIGTERM flush is impossible | A 1 s interval instead; the loss stated (§9) |
| M2: proxy errors unreported, and "proxy is Edge" is wrong | Proxy wrapper; corrections in four places (§6.2, §13) |
| M3: errors under 500 would open issues | Counted, not reported (§3) |
| M4: dedupe incomplete (no digest on route errors) and keyed on raw values | One fingerprint-keyed dedupe for all sources (§9) |
| M5: swallowed errors and `scripts/` not listed | Five storefront catches and `session.ts:185` report; `scripts/` named out of scope, with a follow-up (§2, §6.3) |
| L1: route normalization unnecessary | Validate or `<no-route>`, no rewriting; values pinned by a test (§6) |
| L2: a `.next/` grep trips on source maps | Scan only what ships, excluding maps (§9) |
| L3: a site table makes the AST check brittle | Every `console.error` in non-client files, with an escape (§13) |
| L4: transport didn't match 1a (5 s, `Retry-After` first, https only) | 1a's settings and transport copied exactly (§4, §9) |
| L5: the `:162` trigger breaks every page | A malformed multipart action body instead (§11) |
| L6: Next's request-scoped `fetch` | Sends start only from the `register()` interval, with `no-store` (§9) |
| L7: machine paths in frames and golden files | Strip `process.cwd()`, then `.next/server/` (§6) |
| L8: an "off" boot line on self-hosted installs | Nothing logged when `CRASH_REPORT_HOSTED` is unset (§4) |
| L9: exception shapes | Label as a non-empty value, a thrown non-Error's kind, `error_code` from `cause` (§6; names revised in §16, L7) |
| L10: 787 not 785; Source commit wording; delete to turn off | Corrected (§4, §8, §10, §13) |
| L11: unit tests can't see the Next-specific behaviour | A built-standalone-server test list (§11) |

## 16. Re-review changes (2026-10-15)

The first review's 20 findings: 17 fixed and 3 partly fixed (M1, M3, M5),
completed here.

| Finding | Change |
|---|---|
| H1: `verifySessionToken`'s catch takes every bad cookie, so a database failure would hide in an always-open issue | The `try` is split: token failures stay silent; the account lookup and `getSecretKey()` report (§6.3) |
| M1: the storefront rule would hide #71's Paddle messages and report Paddle outages | A `LicenseApiError` keeps its message and isn't reported; only other errors report, with a generic message. Seven catches, rebased on `4d5e767` (§6.1, §6.3, §13) |
| M2: `instanceof LicenseApiError` is false across bundles | Checks by `name` and a numeric `status`; `instanceof` against app classes banned by the AST check; a built-server test (§3, §11, §13) |
| M3: a raw `name` lets minified library names into the type and fingerprint | 1a's built-in-names rule, plus `LicenseApiError` and `SqliteError` (§6) |
| M4: counting rethrown 400/409s hides 500 pages | Counted by cause: only rejected tenants, revoked sessions and cross-origin action POSTs; 400/409 reported (§3, §14.6) |
| L1: listeners must never throw | Both wrap everything in `try`/`catch` (§7) |
| L2: `register()` idempotence, methods on the object, `unref`, test reset, `next dev` | All stated; `NODE_ENV=production` gate (§4, §5) |
| L3: anonymous action POSTs reach `onRequestError` | Counted (§3); §12 corrected |
| L4: `reportError` has no route; `route_type: proxy` unstated | A literal `route` argument or `<no-route>`; `/proxy` with `route_type: proxy` (§6, §6.2) |
| L5: "loses about 1 s" understated | The last second's reports, 10 s of repeat counts, 60 s of 4xx counts (§9, §10) |
| L6: the error-message check was narrower than 1a's | 1a's full rule on the TypeScript AST, with escapes for the License Server's display text (§8) |
| L7: five "as 1a" claims weren't | Corrected: non-Error values, `LogError`, the `log` fingerprint (now with the cause), the environment set, the hourly refusal warning (§4, §6, §9) |
| L8: the built-server test had no CI recipe | Fixture routes in a scratch copy, a Node envelope recorder, free ports, `PUBLIC_BASE_URL` (§11) |
| L9: process code in `instrumentation.ts`; no `request_id` | The code lives in `lib/crash-reporter.ts`; the privacy comment says the Console sends no `request_id` (§7, §10) |

## 17. Focused-review changes (2026-10-15)

The re-review's 14 findings: 11 fixed, and M1, M4 and L3 partly fixed,
completed by the changes below.

| Finding | Change |
|---|---|
| M1: "any other error is a fault" caught the tenant's own input mistakes (`live.ts:1003`, the mock's validation messages) | They become `LicenseApiError(…, 400/409)` in both clients, with tests (§6.3, §11) |
| M2: counting every 401/403 was too broad (a proxy `Forbidden` would fail every page silently) | Only the `isTenantRejected` shape, 403 `'Unauthorized'`, is counted; every other 401/403 is reported (§3, §11) |
| M3: anonymous multipart POSTs to public pages opened issues | Next's two decoding errors are counted by exact message, pinned in the built-server test; §12 corrected (§3, §11, §12) |
| L1: an escaped page error carries `/login/page` | One trailing `/page` or `/route` is stripped before validating (§6) |
| L2: `UND_ERR_CONNECT_TIMEOUT` fails faultline's pattern | The example dropped; the gap noted for a later faultline change (§6) |
| L3: the error-message check flags about 17 sites, not 5 | The full list, with the mock and `secret-files.ts` excluded and the rest escaped or fixed (§8) |
| L4: creating the reporter inside `register()`'s `try` would let a bug exit the Console | Created after that block, in its own `try` (§5) |
| L5: a storefront 5xx went unreported when the License Server is down | Reported, still showing its message, except the API-key call's `display: true` Paddle answers (§6.3) |
| L6: `reportError`'s route missing from §6.1 | A route column (§6.1) |

