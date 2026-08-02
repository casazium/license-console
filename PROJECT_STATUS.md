# PROJECT_STATUS.md — license-console

Status: Draft
Last updated: 2026-08-02 (confirmed deployment topology: one Coolify instance, two servers, license.casazium.com + license-api.casazium.com)

> Admin console UI for `casazium/license`. This document exists so work can resume
> across sessions without re-deriving decisions already made. Update it whenever
> scope or architecture decisions change.

---

## 1. Purpose

A web admin console for operating a self-hosted instance of `casazium/license`
(single-tenant license server — each operator, e.g. an indie developer, runs
their own instance). Replaces `casazium/admin-ui`, a stale (1 commit,
2025-07-07) scaffold that only covered ~20% of the license server's endpoints
and had no dashboard, auth screen, or activation/usage views.

## 2. Stack decisions

- **Next.js (App Router)** — chosen specifically for its server-side layer, not
  routing convenience. The license server's admin auth is a single static
  `ADMIN_API_KEY` bearer token (`casazium/license/src/hooks/require-admin.js`).
  A plain SPA (what admin-ui was) has no way to keep that token off the client;
  Next.js Route Handlers / Server Components act as a BFF that holds it
  server-side only. `middleware.ts` gates protected routes before render.
- **Mantine** — component library for the UI layer (forms, tables, notifications,
  stat cards). Confirmed a good fit for this app's CRUD/dashboard shape.
- Rejected: reusing/rebuilding inside `casazium/admin-ui` (too little to salvage —
  see comparison below). Rejected: `casazium/mantine` as a starting point (it
  was never the Mantine library — just an unrelated personal Next.js scaffold
  with `@mantine/*` as npm deps; also flagged a prompt-injection attempt in its
  `AGENTS.md`, not acted on).

## 3. Auth model

Single shared admin password for now, **designed not to lock out future
per-user accounts**:

- `lib/auth.ts` — `verifyCredentials(password) → Identity | null`.
  Today: compares against an `ADMIN_UI_PASSWORD` env var, returns a fixed
  `{ id: 'admin', role: 'admin' }`. A `username` parameter is planned — see
  §9 below — not yet implemented. Later: swap the internals to check a real
  user store (in this app's own DB, or a new `/v1/admin/login` endpoint added
  to `casazium/license`) — callers of this function don't change.
- `lib/session.ts` — signs/verifies a session cookie carrying the `Identity`
  object (never the raw password).
- `middleware.ts` — only checks for a valid signed session cookie; has no
  awareness of how login happened.
- `role` is modeled from day one (`role: 'admin'`) even with one identity, so
  future non-admin roles don't require touching the session/middleware layer.

## 4. Backend reference (`casazium/license`)

- Fastify 5 + better-sqlite3. Admin auth: `Authorization: Bearer <ADMIN_API_KEY>`
  checked by `requireAdmin` preHandler hook. No user table, no login endpoint
  today.
- `license_keys` table: `key, product_id, tier, status, issued_to, issued_at,
  expires_at, usage_limit, usage_count, limits (JSON), usage (JSON),
  revoked_at, max_activations`. **No `products` table** — `product_id` and
  `tier` are free-text strings the admin types when issuing a license; nothing
  to pre-register.
- `activations` table: `key, instance_id, activated_at, token_hash`.
- Full endpoint inventory (20 routes) was catalogued during the admin-ui
  comparison — see §5 for which ones this console covers.

## 5. Scope

### Explicitly out of scope (any phase)

Endpoints called by *licensed software via the SDK*, not by a human admin:
`verify-license`, `validate-license`, `activate-license`, `deactivate-license`,
`track-usage`, `verify-license-file`, `verify-license-file-base64`.

### MVP (v1)

| Page | Endpoints | Notes |
|---|---|---|
| `/login` | — | Shared password only |
| `/dashboard` | `GET /admin/stats`, `GET /recent-activations` | Stat cards + activity feed |
| `/licenses` | `GET /list-licenses` | Server-side filter + pagination (server supports it; admin-ui never used it) |
| `/licenses/new` | `POST /issue-license` | Form |
| `/licenses/[key]` | `GET /export-license/:key`, `POST /revoke-license`, `DELETE /delete-license` | Formatted detail view (not a raw JSON dump like old admin-ui); Revoke/Unrevoke + confirm-gated Delete |
| `/licenses/[key]` → Activations | `GET /list-activations/:key`, `POST /admin/reissue-token` | Per-seat table + reissue-token action |
| `/licenses/[key]` → Export menu | `/export-license/:key/file`, `/export-license/:key/offline` | Same dropdown as JSON export |
| `/licenses/[key]` → Activation snippet | — | Code snippet showing how to call `activate-license` from the dev's own app with this key — closes the trial loop for a first-time indie dev evaluating the server end-to-end. Folded into MVP 2026-07-30. |

### Phase 2 (deferred)

- `usage-report` — needs actual product design (chart vs. table, per-license
  vs. aggregate), not just a form/table like the rest of MVP.
- `public-key` / offline-verification reference page — low-traffic utility.
- Any cross-license/global activation search (MVP scopes activations to
  within a license's detail page only).
- Multi-account login + per-account audit logging, and 2FA (TOTP) — see §9's
  Login & branding review for full rationale; UI/session layer is already
  designed not to block on this (§3).

## 6. Sanity check (2026-07-30)

Walked the full indie-developer trial loop against MVP scope: deploy own
instance → log in → issue a license → activate it from their real app via the
SDK → confirm activation shows up in console → test revoke → see it on
dashboard. Confirmed complete with no missing capability; the only gap found
was the missing activation code snippet, now folded into MVP (see table above).

## 7. Scaffolding notes (2026-07-30)

Skeleton built and verified (`npm run build`, `npm run lint`, and a full
Playwright walkthrough of login → wrong-password error → dashboard → nav →
issue-license form validation → license detail dynamic route → sign-out →
re-protection — all passing). Resolved versions: Next 16.2.12, React 19.2.8,
Mantine 9.5.0. Version-specific gotchas hit during setup, worth knowing before
touching `node_modules` or dependency versions again:

- **`eslint` must stay on `^9`.** `eslint-config-next`'s transitive plugins
  (`eslint-plugin-import`, `-jsx-a11y`, `-react`) don't yet support ESLint 10.
  `npm install -D eslint@latest` will silently resolve to 10.x and break lint.
- **`typescript` must stay on `^6`.** Next 16's build-time TS integration
  doesn't support the TypeScript 7 compiler API yet (`npm run build` fails
  outright otherwise, with a pointer to `experimental.useTypeScriptCli`).
- **Next 16 renamed `middleware.ts`/`middleware()` to `proxy.ts`/`proxy()`**
  (this repo's file is `proxy.ts`). It now always runs on the Node.js
  runtime, not Edge - doesn't affect us since `jose` (used for session
  signing) works fine on both.
- **`next lint` was removed entirely**, not just deprecated. Lint runs via
  `eslint .` against `eslint.config.mjs` (flat config) - `eslint-config-next`
  now exports flat-config arrays directly instead of extendable strings, so
  there's no `.eslintrc.json` in this repo.
- **Mantine's `required` prop on inputs sets a native HTML `required`
  attribute.** Combined with `@mantine/form`, this lets the browser's own
  constraint validation block form submission before Mantine's
  `validate`/`onSubmit` ever runs - found via the Playwright test (empty
  issue-license form silently failed to show validation errors). Fixed by
  adding `noValidate` to both forms (`app/login/page.tsx`,
  `app/(app)/licenses/new/page.tsx`); apply the same to any new form.

**Built:** full MVP page shell (`/login`, `/dashboard`, `/licenses`,
`/licenses/new`, `/licenses/[key]`) and working auth end-to-end (login sets a
signed session cookie via `lib/session.ts`, `proxy.ts` gates protected routes,
`/api/logout` clears the session).

## 8. Mock data layer (2026-07-30)

Per operator request, wired every MVP page to `lib/license-client.ts` - an
in-memory mock of the future license-server client (same function
signatures the real client will expose: `listLicenses`, `issueLicense`,
`getLicense`, `setLicenseRevoked`, `deleteLicense`, `listActivations`,
`reissueActivationToken`, `getDashboardStats`, `getRecentActivations`).
Purpose is purely to play with look and feel before real backend
integration - state resets on server restart, seeded with 3 demo licenses.
Mutations go through Server Actions (`app/(app)/licenses/actions.ts`) using
`revalidatePath`, matching the shape real API calls will use later.

Full loop verified via Playwright: login → dashboard shows seeded stats →
licenses list shows seeded data → issue a new license → redirected to its
detail page (which shows the submitted data and an activation code snippet)
→ appears in the list → revoke flips its status badge → reissue-token on a
seeded activation shows a notification with the new token → delete removes
it and redirects to the list.

**Real bug found and fixed, not just a version gotcha:** Mantine's compound
table components (`Table.Thead`, `.Tr`, `.Th`, `.Tbody`, `.Td`) resolve to
`undefined` when `Table` is imported and used directly inside a Server
Component - Next's RSC client-reference proxying doesn't preserve Mantine's
static sub-properties on the `Table` function, even though standalone
exports (`Anchor`, `Badge`, `Button`) resolve fine. This silently 500'd
`/dashboard` and `/licenses` in a way the *first* scaffolding pass's
Playwright test didn't catch, because Next updates the browser URL
optimistically on navigation even when the destination route errors - a
test that only checks `page.url()` after clicking a link can pass while the
page itself is broken. Fixed by moving every actual `<Table>` render into
its own small Client Component (`LicensesTable.tsx`,
`RecentActivationsTable.tsx`) that takes plain data as props from the
Server Component parent that fetches it - same data-down/interactivity-up
split already used correctly in `LicenseActions.tsx`. **Any future page
that renders a Mantine `Table` must do so inside a Client Component, not
directly in a Server Component** - this isn't specific to the mock data,
it'll bite the real API integration too if missed.

**Fixed 2026-07-31** (operator hit the console warning while reviewing the
licenses page): `app/(app)/licenses/page.tsx`'s "Issue license" button used
Next's deprecated `legacyBehavior`/`passHref` Link pattern. The obvious fix
- Mantine's polymorphic `component={Link}` prop, the same pattern already
used correctly in `AppShellClient.tsx`'s `NavLink` - broke the page with a
real server error when tried directly in this Server Component: `Error:
Functions cannot be passed directly to Client Components` - Mantine's
`Button` is itself a Client Component, and RSC forbids passing a function
(the imported `Link` component) as a prop across the Server -> Client
boundary. That's *why* the original code used `legacyBehavior`/`passHref`
in the first place (`component="a"` is a plain string, which serializes
fine). Same root category of bug as the Mantine `Table` issue above, same
fix shape: extracted a small Client Component
(`app/(app)/licenses/IssueLicenseButton.tsx`) that itself imports `Link`
and renders `<Button component={Link} href="/licenses/new">`, so the
function reference never has to cross the boundary. Verified via a clean
`.next` rebuild and a full Playwright pass: no console warning, the button
renders as a real `<a>` (found via `getByRole('link', ...)`, not
`'button'`), and it navigates correctly to `/licenses/new`. **Rule for any
future page:** a Mantine component wrapping `component={SomeImportedFn}`
must live inside a Client Component, not a Server Component that merely
renders it - same constraint as the Table sub-components rule above,
different underlying mechanism (function-prop serialization vs. static-
property proxying).

## 9. Login & branding review (2026-07-30 / built 2026-07-31)

Decisions from an operator walkthrough of the login page (first page in a
planned page-by-page UI review), documented before implementation per
session convention. Operator chose to implement and verify this page's
items before continuing the page-by-page review, since both decisions below
are shared infrastructure (auth/session model, and an app-wide layout
component) that later pages should be reviewed against once real, not while
still hypothetical. **Built and verified 2026-07-31** — see "Implementation
notes" below.

### Username field

- Add a `username` input to the login form, alongside the existing password.
- Single username+password pair, both env-defined: `ADMIN_UI_USERNAME` (new)
  alongside the existing `ADMIN_UI_PASSWORD`. Not multi-account — still
  exactly one valid credential pair; `id` on the returned `Identity` becomes
  the configured username instead of the hardcoded `'admin'`.
- Login error stays generic ("Invalid username or password"), not
  field-specific, to avoid revealing which credential was wrong.

### Branding (logo / title / copyright)

- **Scope: app-wide.** A shared branding component/config, used on both
  `/login` and inside `app/(app)/layout.tsx` — not login-only. This app is
  explicitly meant to support multiple isolated deployments (e.g. resold or
  operator-branded instances), so a branded login screen followed by an
  unbranded app would read as unfinished.
- **Logo:** env-configured, supports a remote URL (not just a local
  `public/` file) so an operator can swap branding without a redeploy.
  Rendered via a plain `<img>`, not Next's `<Image>`, to avoid
  `next.config.js` remote-host allowlisting.
- **Title:** single env var, always rendered as HTML (via
  `dangerouslySetInnerHTML` — plain text renders fine through the same path,
  so there's no separate "text" vs. "HTML fragment" mode). This is
  operator-controlled config, not user input — legitimate use of
  `dangerouslySetInnerHTML`, but flag it with a comment at the call site so
  the pattern isn't later copied somewhere untrusted input could reach it.
- **Copyright:** app-wide placement alongside the branding; separate
  plain-text env var for the copyright holder name (kept distinct from the
  possibly-HTML title, so nothing has to parse text back out of markup);
  year computed dynamically at render (`new Date().getFullYear()`), not
  hardcoded.

### Deferred (logged for a future user-store phase, not part of this pass)

- **Failed-login rate limiting / lockout.** Independent of the items above —
  can land anytime, not blocked on multi-account.
- **Multi-account login + per-account audit logging.** Supersedes the old
  "Multi-account login (backend work)" note in §5 — real per-user accounts
  (not just a display-name username) with logged actions, once "multiple
  consoles/admins share one backend" is a real requirement rather than a
  hypothetical raised during this review.
- **2FA (TOTP).** Technically small to add (`otpauth` + `qrcode` — neither
  currently a dependency) but blocked on the same thing multi-account is: a
  TOTP secret is per-identity and needs durable storage that doesn't exist
  under an env-only credential model. Sequence it after the user store
  lands, with a `totp_secret` field designed into that store from day one.

### Implementation notes (2026-07-31)

Built: `lib/branding.ts` (`getBranding()`, reads `BRANDING_LOGO_URL` /
`BRANDING_TITLE_HTML` / `BRANDING_COPYRIGHT_HOLDER`); `components/BrandLogo.tsx`,
`BrandTitle.tsx`, `BrandCopyright.tsx` (all plain server-renderable, no
client-only hooks); `lib/auth.ts`'s `verifyCredentials` now takes
`(username, password)`. Both `/login` and `app/(app)/layout.tsx` were split
into a Server Component (reads branding/env) plus a Client Component
(`LoginForm.tsx`, `AppShellClient.tsx`) for the interactive parts — env vars
can't be read directly inside a `'use client'` component.

Verified via `npm run build`, `npm run lint` (0 errors), and a full
Playwright walkthrough (wrong-password generic error → correct login →
dashboard → `/licenses/new` with branded header/footer visible throughout).

Two real bugs found and fixed during verification, not just version
gotchas:

- **`next build` prerendered `/login` (and any branding-only `(app)` page,
  e.g. `/licenses/new`) as static.** Since `getBranding()` has no other
  dynamic dependency (no `cookies()`/`headers()`), Next inferred those
  routes could be fully static and would have baked in whatever branding
  env vars were set *at build time* — silently defeating the "operator can
  change branding without a rebuild" requirement this review specifically
  decided on. Fixed with `export const dynamic = 'force-dynamic'` in both
  `app/login/page.tsx` and `app/(app)/layout.tsx` (the latter propagates to
  every child route, including `/licenses/new`).
- **An env value containing `#` gets silently truncated.** `BRANDING_TITLE_HTML`
  set to an unquoted value containing a CSS hex color (e.g.
  `<span style="color:#2563eb">...`) got cut off right before the `#` -
  dotenv-style `.env` parsing treats an unquoted `#` as a comment marker.
  Not a code bug (quoting the value, e.g. `BRANDING_TITLE_HTML="<span
  style='color:#2563eb'>..."`, parses correctly), but a real operational
  gotcha likely to bite anyone setting an HTML/CSS title - documented in
  `.env.example`'s `BRANDING_TITLE_HTML` comment.

Also fixed two empty-chrome edge cases: the login page's header/footer
regions and the app shell's footer region only render when the
corresponding branding field is actually configured, instead of showing an
empty bar when `BRANDING_LOGO_URL`/`BRANDING_COPYRIGHT_HOLDER` are unset.

### Design review round 2 (2026-07-31)

Operator ran the built login page in their own local environment and shared
a screenshot with a self-configured logo/title/copyright. Critical design
review surfaced two real defects and one deliberate non-fix:

- **Color inconsistency.** The logo, the title's accent color, and the
  primary button were three unrelated colors (a violet logo, a saturated
  pure-blue title accent, a separate muted-blue button) — because
  `BRANDING_TITLE_HTML` and the button each had their color set
  independently, with no shared source of truth. Root-caused, not just
  patched at the symptom: added a new `BRANDING_COLOR` env var (any valid
  CSS color, defaults to Mantine's standard blue `#228be6` if unset),
  exposed as a `--brand-color` CSS custom property on `<body>` in the root
  layout (`app/layout.tsx`) so it cascades to every page. Operators
  reference it in `BRANDING_TITLE_HTML` via `var(--brand-color)` instead of
  hardcoding a hex, and the primary button (`LoginForm.tsx`'s "Sign in")
  picks it up via Mantine's own overridable `--button-bg`/`--button-hover`
  CSS variables. One env var now drives both, so they can't drift apart the
  way they did in the reviewed screenshot. Scoped to the login page's
  primary button only, not a full Mantine `primaryColor` theme regeneration
  (which would need a 10-shade palette generated from one hex, e.g. via
  `@mantine/colors-generator` - not installed) — a natural larger version of
  this if the operator wants every button/link app-wide to pick it up later,
  not built now.
- **Excessive gap above the title.** `app/login/page.tsx`'s content Stack
  used `justify="center"` within a `flex: 1` region filling the entire
  remaining viewport height - on a tall viewport that centers a short
  title+card block in the middle of a 1000px+ tall space, producing a large,
  viewport-height-dependent gap both above and below it. Replaced with
  `justify="flex-start"` and `paddingTop: 'clamp(24px, 8vh, 96px)'`, so the
  title sits a consistent, bounded distance below the header regardless of
  viewport height, and any excess space collects below the card instead of
  splitting evenly above and below it.
- **Title font size — deliberately left alone.** The reviewed screenshot's
  title rendered far larger than this app's own default (its
  `BRANDING_TITLE_HTML` value set its own large size). Operator's explicit
  call: the developer/operator configuring `BRANDING_TITLE_HTML` should
  control this themselves via their own markup, not have the app impose a
  size cap or a different hardcoded default. No code change made for this
  item - confirms the existing behavior (operator's inline styles in their
  title HTML already win) is correct as-is.

Verified: `npm run build` (0 errors, same dynamic-route set as before),
`npm run lint` (0 errors), and a visual re-check (same test config as the
reviewed screenshot, plus `BRANDING_COLOR="#2563eb"` and the title
referencing `var(--brand-color)`) confirming the logo, title accent, and
button now render as the same color, and the header-to-title gap is
visibly tightened.

**Follow-up verification, prompted by the operator asking to double-check:**
the round-2 visual check above used `BRANDING_COLOR="#2563eb"`, which is
close enough to Mantine's own default blue (`#228be6`) that a broken
override could have looked correct by coincidence. Re-verified with a
clearly distinct test color (`#ff6600`) and confirmed via a real browser's
computed style (`getComputedStyle(button).backgroundColor` ===
`rgb(255, 102, 0)`), not just visual inspection — the override genuinely
works, not a false-positive from two similar blues. Separately, an
operator-reported "no effect" turned out to be their own `.env.local`
value being unquoted with a leading `#` (same class of bug as the
`BRANDING_TITLE_HTML` truncation above, and just as silent - the *entire*
value is dropped since it starts with `#`, not merely truncated
mid-string, silently falling back to the default blue).

### Design review round 3 (2026-07-31)

- **Semantic heading level — discussed, not yet implemented.** `BrandTitle`
  always renders a plain `<div>`. Checked: every authenticated page
  (`dashboard`, `licenses`, license detail) already uses Mantine
  `Title order={2}` (i.e. `<h2>`) as its own primary content heading. On
  `/login`, where nothing else competes, the brand title should really be
  `<h1>`; in the app header (shown on every authenticated page), it should
  stay a non-heading element so it doesn't create a second, competing
  top-level heading alongside each page's own `<h2>`. Proposed adding an
  `as` prop to `BrandTitle` so each call site can choose - **not yet
  authorized or built**, tracked here so it isn't lost. **Partially moot as
  of the "App header title removed" note in §10 below** - the app-header
  half of this question no longer applies, since the header doesn't render
  the title at all anymore. The `/login` half (should it be `<h1>`) is
  still open if the operator wants it.
- **Font size - confirmed still fully operator-controlled, no new config.**
  Operator asked whether a dedicated `BRANDING_TITLE_FONT_SIZE`-style env
  var was warranted. Decided no: operators can already set `font-size`
  inline in `BRANDING_TITLE_HTML` today, and a parallel env var would just
  be a narrower second way to do something the raw-HTML path already
  covers - would work against the original "arbitrary HTML fragment"
  design intent. One real gotcha documented instead: the wrapper's own
  default size only applies to *unstyled* parts of the title, so wrapping
  only part of the string (e.g. just the colored word) in a custom
  `font-size` leaves the rest at the default size - confirmed empirically
  by parsing an operator-provided example through Next's actual env
  loader, not just reasoned about.
- **False-positive hydration warning suppressed.** Some browser extensions
  (e.g. ColorZilla - plausible given the operator has been color-matching
  their logo all session) inject attributes like `cz-shortcut-listen` onto
  `<body>` before React hydrates, which React reports as a mismatch even
  though it isn't an app bug. Added `suppressHydrationWarning` to `<body>`
  in `app/layout.tsx`, scoped to that element only (doesn't hide a real
  mismatch elsewhere) - `<html>` already does the same for Mantine's own
  color-scheme script.
- **CORS clarified (no code change - the existing design already avoids
  it).** Operator asked whether a remote `BRANDING_LOGO_URL` could hit CORS
  issues. It can't: CORS only applies to `fetch()`/XHR and canvas pixel
  reads, not to a plain `<img>` (or `<link rel="icon">`) loading and
  displaying a cross-origin resource, which is all `BrandLogo` does. The
  allowlisting Next's `<Image>` component would need is an unrelated,
  Next-specific SSRF guard for its server-side image optimizer - already
  sidestepped by using a plain `<img>` (documented at the time in round 1).
- **Favicon added.** New `BRANDING_FAVICON_URL` (same local-or-remote, no
  CORS/allowlist concern as `BRANDING_LOGO_URL`). Required converting
  `app/layout.tsx`'s `metadata` export from a static object to Next's
  `generateMetadata()` async function, so the favicon is read from env
  per-request rather than baked in at build time - consistent with every
  other branding field. Falls back to Next's own default favicon if unset.
  Verified: build/lint clean, and confirmed the `<link rel="icon">` tag
  carries the correct href both in raw server-rendered HTML and in an
  actual browser DOM (`document.querySelector('link[rel="icon"]')`).

## 10. Dashboard review (2026-07-31)

Deep-research pass on the dashboard page (second page in the page-by-page UI
review), cross-referencing the actual `casazium/license` backend
schema/routes directly (not just this app's mock) to find real gaps
grounded in actual backend capability, rather than a speculative feature
wishlist. Documented before implementation, per session convention.

Verified against the backend source (`casazium/license`, read-only clone,
not modified):

- `license_keys` has `expires_at`, `max_activations`, `issued_at` - all
  usable for the widgets below with zero backend changes.
- Confirmed `POST /deactivate-license` (`deactivate-license.js:69`)
  `DELETE`s the activation row outright, not a soft-delete - so "total
  activations" and "active activations" are the same count, not a hidden
  second metric. A hypothesis from the research that turned out false;
  recorded here so it isn't re-investigated later.
- Confirmed failed activation attempts (expired / revoked /
  activation-limit-exceeded / not-found - see `activate-license.js:61-91`)
  are only written to the server's application log via `fastify.log.error`,
  never persisted anywhere queryable through the API. A real gap (leaked-key
  detection), but needs new backend instrumentation - explicitly out of
  scope for this pass.
- `/admin/stats` already returns `totalLicenses`, distinct from the
  active/revoked counts this app's mock computes - not pursued as its own
  widget, since active + revoked already sum to it (low-value, would just
  be a fourth number restating the other three).

### Decided: three new dashboard sections, all buildable with zero backend changes

1. **Licenses expiring soon** (next 30 days). Highest-value item from the
   research - renewal/churn visibility didn't exist on the dashboard at
   all before this. Active licenses only, sorted soonest-first, limit 5.
   Empty state phrased as good news ("nothing expiring soon"), not an
   error state, and with no call-to-action - unlike the "no licenses yet"
   empty state elsewhere, there's nothing actionable to do about an empty
   expiring-soon list.
2. **Seats near their activation limit** (0 or 1 remaining seat). Surfaces
   both an upsell signal (customer wants more seats) and a support-friction
   signal (customer capped and doesn't know why). Active licenses only,
   sorted fewest-remaining-first, limit 5.
3. **Recently issued licenses.** Mirrors the existing "Recent activations"
   table but for issuance events - answers "are people buying" as
   distinct from "are people using what they bought." Issued, activated,
   and active are three genuinely different states (a license can be
   issued and never activated; activation is customer/product-initiated
   via the public `POST /activate-license`, not an admin action) - the
   dashboard previously only showed activation activity, with zero
   visibility into issuance. No time window, just top 5 by `issued_at`,
   matching the existing Recent activations table's own pattern.

Explicitly not pursued this pass (from the same research, correctly out of
scope): usage-quota-risk aggregation across all licenses (needs a new
backend endpoint - `usage-report` is per-key only today), failed-activation
visibility (needs new backend instrumentation, see above), revenue/MRR and
CRM-style customer context (belong to a billing system / CRM, not a
license server - this backend has no price/currency/subscription concept
anywhere in its schema), and abuse/geo signals on activations (new
instrumentation with its own privacy tradeoffs).

### Implementation notes (2026-07-31)

Built: `lib/license-client.ts` gained `getExpiringLicenses(withinDays=30,
limit=5)`, `getLicensesNearSeatLimit(limit=5)`, and
`getRecentlyIssuedLicenses(limit=5)`, plus their result types
(`ExpiringLicense`, `SeatUtilization`, `RecentlyIssuedLicense`) - all pure
computation over the existing mock store, no new backend dependency. Added
a fourth seed license (`CASZ-DEMO-DELTA-0004`) with `expires_at` computed
relative to `Date.now()` at seed time (14 days out) specifically so the
"expiring soon" widget demonstrates a populated list out of the box, not
just its empty state - the three original seed licenses all have fixed
2026 dates that don't fall in a rolling 30-day window. Three new Client
Components (`ExpiringLicensesTable.tsx`, `SeatUtilizationTable.tsx`,
`RecentlyIssuedLicensesTable.tsx`), matching the existing
`LicensesTable.tsx`/`RecentActivationsTable.tsx` pattern (Client Component,
clickable keys via `Anchor component={Link}`, contextual empty state -
"good news, no action needed" for the expiring/seat-limit tables vs. the
actionable "issue your first license" CTA for the issued-licenses table,
reused from the main licenses page). `app/(app)/dashboard/page.tsx` fetches
all five datasets via one `Promise.all` and renders four sections in order:
Recently issued → Recent activations (existing) → Expiring soon → Seats
near capacity - a deliberate narrative (top-of-funnel issuance, to
actual usage, to two renewal/support risk signals).

Verified via `npm run build` (0 errors), `npm run lint` (0 errors), and a
full Playwright walkthrough: all three new section headings present, the
seeded `DELTA-0004` license appears correctly in "Expiring soon" (14 days
out, within the 30-day window) while the other three do not (two outside
the window, one revoked and excluded entirely), and "Seats near capacity"
correctly surfaces all three licenses at or within one seat of their limit
(`BETA-0002` 1/1 - red badge, `ALPHA-0001` 2/3 and `DELTA-0004` 1/2 - both
yellow), confirmed via a full-page screenshot, not just presence checks.

### App header title removed (2026-07-31)

Operator ran the dashboard with their own real branding config and shared
a screenshot: the app header showed "Casazium License Console" with a
severe size mismatch ("Casazium" at the operator's explicit `2.5rem`,
" License Console" falling back to the header's own `1rem` default) - the
exact "partial wrap" gotcha flagged during the login/branding review,
now visibly broken in the header's much tighter 60px bar rather than just
loosely mismatched like on `/login`. A second, independent problem: the
logo lockup itself already includes the "Casazium" wordmark, so the title
text repeated the brand name immediately next to it.

**Decided:** remove the title text from the app header entirely, keep only
the logo there. Resolves both problems at once (no title markup left to
mis-render; no redundant wordmark) and, as a side effect, closes the
still-open "semantic heading level" item from §9 above - with no title
text in the header, there's no `<h1>`-vs-non-heading conflict to resolve
there at all. The title remains unchanged on `/login`, where it's the
actual hero content and this problem doesn't arise. `AppShellClient.tsx`
no longer imports `BrandTitle`.

Verified: `npm run build`/`npm run lint` clean, and a Playwright check
reproducing the operator's exact reported config (same title HTML, same
brand color) confirming the header's `innerText` no longer contains the
title text at all - screenshot reviewed, logo-only header confirmed clean.

## 11. Licenses page review (2026-07-31)

Operator asked, reviewing the licenses list page: why can't I sort columns,
shouldn't there be more columns (matching the dashboard work), where's
search/filter, and what happens at 200 licenses? Documented before
implementation, per session convention. Grounded against the real
`casazium/license` backend's actual `GET /list-licenses` route
(`src/routes/list-licenses.js`), not assumptions:

- Confirmed the route already accepts `product_id` (exact match) and
  `status` filters, plus `limit`/`offset` pagination (default 50, max
  1000) - all directly usable with zero backend changes.
- Confirmed the route has **no sort parameter at all** - its query is
  hardcoded to `ORDER BY issued_at DESC`. A true full-dataset sort isn't
  possible without a backend change; anything built now can only be a
  client-side sort of whatever page is currently loaded.
- Confirmed the route's response (`key, tier, product_id, issued_to,
  issued_at, expires_at, status, usage_limit, usage_count, revoked_at`)
  does **not** include an activation/seat count - there's no free
  "seats used" field to display without either an N+1
  `GET /list-activations/:key` call per row or a backend addition.

### Decided

1. **Pagination.** This app's mock `listLicenses()` currently ignores
   pagination entirely, returning every license unpaginated - a real,
   already-present bug at any real scale, not just a future concern. Fixed
   by giving the mock the same interface shape as the real endpoint
   (`{ licenses, total }`, params `product_id` / `status` / `limit` /
   `offset`) so wiring the real client later is a drop-in swap, per this
   app's own stated design goal (§2). Page size: 10, via a `?page=` URL
   param (URL-driven, not component state, so pages are bookmarkable/
   shareable - same reasoning as any server-rendered list).
2. **Status/product filters.** Dropdowns for both, using the exact params
   the backend already accepts. URL-driven alongside pagination.
3. **Seat-utilization column.** Added to the table, reusing the same
   used/max computation and badge coloring already built for the dashboard
   widget. **Caveat, not solved here:** this is mock-only enrichment. The
   real backend's `/list-licenses` response has no such field - wiring the
   real client will need either N+1 `list-activations` calls (real cost at
   200+ rows) or a backend PR to include the count directly. Recommending
   the backend addition when that work happens, not the N+1 path.
4. **Client-side sort, current page only.** Click-to-sort column headers,
   scoped honestly to the loaded page - not presented as a full-dataset
   sort, since the backend genuinely can't do that today.
   **Confirmed as a real limitation, not a bug, during operator testing
   (2026-07-31):** operator reported "filtering only filters the displayed
   page" after using the app. Reproduced precisely to isolate which
   feature was actually at fault: status/product filtering was verified
   correct - both re-query the full 28-license dataset server-side (e.g.
   `?status=active` correctly returns "10 of 23", not scoped to one page),
   confirmed by applying a filter while sitting on page 2 and seeing it
   reset to page 1 with the right full-dataset count. The sort feature was
   the actual source: clicking a column header only reorders the same 10
   already-loaded rows (verified: identical row count and identical row
   *set* before/after sorting, just reordered) - functioning exactly as
   designed, but with zero visual indication in the UI that sort is
   page-scoped, which reads exactly like a bug from the operator's side.
   **Decided: keep the UI as-is for now (no caption/tooltip added, sort
   feature not removed).** Real fix is a backend addition, not a console
   change - `GET /list-licenses` needs an actual sort parameter so a true
   full-dataset sort becomes possible; the console's current click-to-sort
   UI can then be pointed at it directly, no redesign needed on this side.
   **Logged as a backend roadmap item, same category as the deferred items
   above and in §9** (free-text search, rate limiting, multi-account, 2FA).
5. **Free-text search - deferred, not built.** No search endpoint exists on
   the backend at all (only exact-match `product_id`/`status`). A
   client-side-only search would silently only cover the current page,
   which is worse than not having it - misleads the operator into thinking
   they searched everything. Logged as a backend roadmap item: a real
   search endpoint (by key or `issued_to`) is a prerequisite for this,
   same category as the other deferred backend items in §9 (rate limiting,
   multi-account, 2FA).

Seed data: expanded beyond the original 4 demo licenses specifically so
pagination/filtering/sorting are genuinely demonstrable and testable
during verification, not just theoretically wired - same reasoning as the
`DELTA-0004` addition for the dashboard's expiring-soon widget. Added 24
synthetic licenses (28 total) via a small generator, varied across 3
products/3 tiers/mixed status/spread issue and expiry dates, enough for 3
pages at a 10-per-page size.

### Implementation notes (2026-07-31)

Built: `lib/license-client.ts`'s `listLicenses()` now takes
`{status, product_id, limit, offset}` and returns `{licenses, total}` -
matching the real endpoint's actual shape exactly (params and response),
not just "close enough," so swapping in the real client later is a
drop-in replacement per this app's stated design goal. Added
`LicenseListItem` (`License & {activations_used}`) and
`ListLicensesParams`/`ListLicensesResult` types. New
`LicensesFilters.tsx` (status `Select`, product `TextInput` - not a
dropdown, deliberately, since the backend has no products table to source
options from) and `LicensesPagination.tsx` (Mantine `Pagination`), both
URL-search-param-driven via `next/navigation`, so pages/filters are
bookmarkable and changing a filter resets `page`. `LicensesTable.tsx`
gained a Seats column (same used/max badge coloring as the dashboard
widget) and click-to-sort column headers (client-side, current page only
- labeled honestly given the backend has no sort parameter at all), plus
a filter-aware empty state (`hasFilters` prop: "no licenses match these
filters" vs. the original actionable "issue your first license").
`app/(app)/licenses/page.tsx` reads `searchParams` (Next's async
`Promise<{...}>` convention, matching how `licenses/[key]/page.tsx`
already handles `params`) and computes offset/limit from `page`.

Verified via `npm run build`/`npm run lint` (0 errors) and a full
Playwright pass - initially caught a false alarm worth recording: the
first pagination-click test checked the URL immediately after `.click()`
and saw no change, which looked like a real bug. Re-tested with
`page.waitForURL(...)` instead of an immediate check: the client-side RSC
navigation genuinely takes about a second to resolve, which
`waitForLoadState('networkidle')` doesn't reliably wait for - not an
app defect, a test-timing issue. Corrected verification confirmed:
page 1 vs. page 2 show different first keys; page 3 has exactly 8 rows
(28 total, 10 per page); `status=revoked` filter returns only revoked
rows (5 of 28); `product_id=gadget-basic` returns only matching rows (8
of 28); changing a filter while on page 3 correctly drops the `page`
param back to 1; the empty-filtered state shows the correct message
without the "issue your first license" CTA; and clicking the Key column
header sorts ascending then descending correctly, verified against a
genuinely-sorted comparison array, not just eyeballed.

## 12. Brand color extended to remaining primary actions (2026-07-31)

Operator noticed the "Issue license" button and the licenses page's
pagination controls looked out of place - default Mantine blue, not the
configured brand color, unlike the login page's Sign In button. Confirmed
in the code: `IssueLicenseButton.tsx` and `LicensesPagination.tsx` were
both built later (during the licenses-page review) and never got the
`--brand-color` treatment `LoginForm.tsx`'s Sign In button already had.

Asked whether the license detail page's Revoke/Delete buttons had the
same gap. Checked the code: no - `Revoke`/`Unrevoke` uses
`variant="default"` (neutral) and `Delete` uses `color="red"`
(`LicenseActions.tsx`), both deliberate semantic choices, not an
oversight. **Decided, and would have pushed back on the alternative even
if asked:** leave these two alone. Red for a destructive action is a
near-universal UI convention specifically so it stands out from ordinary
branded actions - re-coloring Delete to match an arbitrary operator's
brand color would weaken that "this is dangerous" signal for the sake of
consistency that isn't actually a virtue here.

**Built:** extracted the brand-button CSS-variable override (previously
inlined only in `LoginForm.tsx`) into a shared
`components/brandButtonStyle.ts`, applied to both `IssueLicenseButton.tsx`
and the now-refactored `LoginForm.tsx` (no behavior change there, just
de-duplication). Applied the equivalent override
(`--pagination-active-bg: var(--brand-color)`) to `LicensesPagination.tsx`
- Mantine's `Pagination` exposes the same kind of overridable CSS variable
`Button` does, same technique.

Verified via build/lint (0 errors) and a real browser check with a
distinctive test color (`#7341E0`): confirmed via computed style that
"Issue license" (`rgb(115, 65, 224)`) and the active page control both
resolve to the exact brand color. One test-script false alarm caught and
corrected along the way: an initial generic `[data-active="true"]`
selector matched the sidebar's active nav link (which also uses that
attribute) instead of the pagination button, giving a misleading "still
blue" result - re-queried with `button[data-active="true"]` specifically
and confirmed the fix works correctly. Also confirmed Revoke/Delete remain
unstyled/red respectively, unaffected by this change.

## 13. Real backend integration (2026-08-02)

Operator asked to start wiring the console to the real `casazium/license`
backend, with one explicit requirement: keep a standalone (look-and-feel-
only) mode available, no real backend required. Researched the actual
backend routes precisely (not assumptions) before writing any code -
findings and the resulting three decisions were confirmed with the
operator via direct questions rather than picked unilaterally:

1. **Mode selection: auto-detect from env.** Both `LICENSE_API_URL` and
   `LICENSE_ADMIN_API_KEY` set -> live; both unset -> standalone/mock;
   exactly one set -> fail fast with a clear error (almost certainly a
   misconfiguration, not an intentional choice). No new env var needed.
2. **No backend endpoint returned one license's full admin record**
   (status, issued_at, usage_count, revoked_at, max_activations) -
   `GET /export-license/:key` looks like the obvious candidate but is
   actually a different, narrower thing (a signed public export for
   offline verification). Added `GET /admin/license/:key` to
   `casazium/license` rather than working around the gap client-side -
   same pattern as the earlier `admin/reissue-token` addition. Committed
   there as a draft (`admin/get-license-endpoint` branch, not yet pushed)
   - also fixed a confirmed, pre-existing bug found during that research:
   `list-licenses.js`'s declared response schema and its actual SQL
   `SELECT` had drifted out of sync (schema promised `max_activations`
   but the query never fetched it; the query fetched
   `issued_at`/`usage_limit`/`usage_count` but the schema didn't declare
   them, so Fastify's serializer silently stripped them). Both sides
   reconciled, regression test added, backend's full suite still
   141/141 passing.
3. **Dashboard widgets + Seats column compute client-side for now.**
   `getExpiringLicenses`/`getLicensesNearSeatLimit` have no backend
   equivalent (the backend has no sort parameter at all) - both fetch a
   broad `GET /list-licenses` page (up to the backend's own 1000-row max)
   and compute the same filter/sort the mock does, client-side.
   `getLicensesNearSeatLimit` and the Seats column both additionally need
   one `GET /list-activations/:key` call per license row (no
   activation-count field exists) - real N+1 cost, accepted for now per
   the operator's explicit choice. `getRecentlyIssuedLicenses` needed
   none of this: the real `GET /list-licenses` already defaults to
   `ORDER BY issued_at DESC`, so it just asks for `limit` rows directly.

### Built

Split `lib/license-client.ts` into three files: `lib/license-types.ts`
(shared types, no implementation), `lib/license-client.mock.ts` (the
original in-memory implementation, moved as-is), `lib/license-client.live.ts`
(new - real `fetch()` calls, mapped 1:1 to the endpoints above).
`lib/license-client.ts` is now a thin dispatcher - `getBackendMode()` plus
one wrapper per function routing to whichever implementation is active,
read fresh on every call (not cached at module load), consistent with how
`lib/branding.ts` handles env. Every page still imports only from
`@/lib/license-client`, unchanged - this was the whole point of the mock's
original "match the real signatures" design goal (§2).

Two return-type simplifications, justified by checking actual call sites
(`app/(app)/licenses/actions.ts` and its callers) rather than assumption:
`issueLicense` now returns `{ key: string }` (only `.key` was ever read -
the real `POST /issue-license` response doesn't include the rest of a
`License` object anyway) and `setLicenseRevoked` now returns `void`
(nothing read its return value at all). Both mock and live implement the
same simplified signatures.

Found and fixed one real bug while verifying, unrelated to the client
split itself: all three pages (dashboard, licenses list, license detail)
unconditionally showed "Showing mock data... not yet wired to the real
license server" - true before this work, but it would have kept claiming
that even once genuinely connected to a real backend. Extracted a shared
`components/MockDataNotice.tsx`, conditional on `getBackendMode() ===
'mock'`, used on all three pages in place of the hardcoded text.

### Verified

Mock mode: rebuilt and re-tested after the file split - unchanged
behavior confirmed (seeded demo data present, mock notice still shows,
pagination/filter behavior from §11 intact).

Live mode: **ran a real local instance of `casazium/license`** (generated
throwaway `ENCRYPTION_KEY`/`LICENSE_SIGNING_SECRET`/`ADMIN_API_KEY`/
`LICENSE_RSA_PRIVATE_KEY` values, `npm run dev`) rather than mocking the
HTTP layer, and pointed a live-mode console build at it. Full Playwright
walkthrough against the real server: login -> dashboard shows real stats
(confirmed via screenshot, not just presence checks) -> issue a license
through the real UI form -> real redirect to its detail page showing
correct real data -> activated it via `curl` (simulating the licensed
product itself, exactly matching the detail page's own code snippet) ->
console correctly shows the real activation -> reissued its token ->
revoked -> un-revoked -> deleted -> confirmed gone from the list. Also
directly `curl`-verified the new endpoint and the list-licenses fix
against the running backend before touching the console at all.

Two genuine test-script false alarms caught and corrected during this
pass, not app bugs - worth recording since both looked exactly like real
bugs at first:
- A `waitForURL('**/licenses/*')` after submitting the issue-license form
  matched instantly, because the *starting* URL (`/licenses/new`) already
  satisfies that glob (`new` matches the trailing `*`). Looked like the
  redirect never happened; it just hadn't happened *yet* when checked.
  Fixed by waiting on a precise negative condition instead
  (`!pathname.endsWith('/licenses/new')`).
- After a delete, checking whether the deleted key still appeared
  anywhere in the page text returned true - looked like the list still
  showed it. It didn't: the list correctly showed "No licenses yet.", and
  the match was the delete confirmation *toast*, which intentionally
  displays the deleted key as part of its message.
- Separately, mid-verification, the backend's own admin-endpoint rate
  limit (50 requests/15 min, by design - see `src/app.js`) was genuinely
  exhausted by the volume of manual + Playwright testing in this pass, not
  triggered by anything the app itself does in normal use. Not a bug;
  resolved by restarting the local backend (in-memory rate-limit counters
  reset) and testing more economically afterward.

## 14. Coolify deployment packaging (2026-08-02)

Operator asked to set up a live POC, reachable via Coolify. Checked first
rather than assuming: this repo had **no Dockerfile and no compose file at
all** - it had only ever been run via `npm run dev`/`next start` in this
session. `casazium/license` already had both a `Dockerfile` and a plain
`docker-compose.yml`, but no Coolify-specific compose file either.

Two decisions confirmed with the operator directly:

1. **Two separate Coolify resources, not one combined stack.** Each gets
   its own domain and is independently deployable/restartable - matches
   how `casazium/casazium`'s docs site is already a separate Coolify
   resource from web+api, and matches reality anyway: the backend needs
   its own public domain regardless (real licensed products call it
   directly, not just this console).
2. Operator confirmed a Coolify instance and server target are already in
   place; domains to be provided separately when creating the resources.

### Built

`next.config.mjs` gained `output: 'standalone'` (Next's self-contained
server bundle, needed to keep the Docker image from shipping the full
`node_modules` tree). Added `public/` (didn't exist - a `.gitkeep`
placeholder, since the standard Next.js Docker `COPY --from=builder
/app/public` step would otherwise fail on a missing directory). New
`Dockerfile` (standard three-stage Next.js standalone pattern,
`node:22-alpine` matching `.nvmrc`). New `docker-compose-coolify.yml` for
both this repo and `casazium/license` (draft, uncommitted there as of this
writing), following `casazium/casazium`'s existing Coolify convention
exactly rather than inventing a new one - `traefik.enable` + a bare
`loadbalancer.server.port` label, no hand-authored router (Coolify owns
routing/TLS via its own per-service Domain field), health checks, no
`env_file` (Coolify injects env vars itself via `${VAR}` passthrough in
the compose `environment:` block, configured through its own UI - nothing
is hardcoded or committed).

Live vs. standalone mode in the deployed console still works exactly as
already designed (§13): leaving `LICENSE_API_URL`/`LICENSE_ADMIN_API_KEY`
unset in the Coolify env var UI runs it in standalone/mock mode on a real
public domain; setting both to the backend resource's own Coolify domain
connects it live. No new mode-selection mechanism needed for deployment -
this was already the point of building it that way in §13.

### Verified, and one real environment limitation hit

Confirmed `next.config.mjs`'s `output: 'standalone'` actually produces a
working `.next/standalone/server.js` (`npm run build`, inspected the
output directly). Attempted a real `docker build` of the new Dockerfile -
blocked by this sandbox's own network policy (`docker.io`/CloudFront pulls
return a policy-level 403, confirmed via the agent proxy's own status
endpoint, not a transient failure or something fixable here). Rather than
leaving the Dockerfile unverified, replicated its final stage manually
outside a container - copied `public/`, `.next/standalone`, and
`.next/static` into a clean directory (exactly what `COPY --from=builder`
would produce) and ran `node server.js` directly with the same env vars
and `CMD` the Dockerfile declares. Full Playwright walkthrough against
that: login → dashboard (seeded mock data present) → licenses list, zero
failed requests or console errors - confirms the runtime stage works
correctly. **Not independently verified: the containerized `npm ci && npm
run build` step itself** (low risk assessed - no native/binary
dependencies in this repo that would behave differently under Alpine's
musl libc, unlike `casazium/license`'s `better-sqlite3`) - worth a real
`docker build` once deployed somewhere with registry access, before
relying on it further.

Both `docker-compose-coolify.yml` files validated with `docker compose
config` (daemon started locally for this - config parsing doesn't need
registry access, only `docker build` does) - both parse cleanly, and the
console's confirmed to correctly resolve to standalone/mock mode when
`LICENSE_API_URL`/`LICENSE_ADMIN_API_KEY` are left blank, matching the
intended default.

## 15. Deployment topology confirmed (2026-08-02)

Both Coolify PRs merged (`casazium/license-console#8`,
`casazium/license#27`). Operator confirmed the concrete deployment shape:

- **One Coolify instance, two connected servers** (separate VPS, separate
  IPs) - not two independent Coolify instances. Each of the two resources
  (this repo + `casazium/license`) picks its own target server from the
  same Coolify dashboard.
- **Domains:** `license.casazium.com` (this console) and
  `license-api.casazium.com` (the backend) - chosen over the more generic
  `api.casazium.com` specifically so it stays unambiguous if
  `casazium.com` ever grows other, unrelated APIs later.
- Confirmed this requires no compose-file changes - domains are set
  through Coolify's own per-service Domain field, never hardcoded in
  `docker-compose-coolify.yml` (§14's whole point). Once
  `license-api.casazium.com` DNS resolves and its Coolify resource is up,
  this console's `LICENSE_API_URL` env var should be set to
  `https://license-api.casazium.com/v1` (the `/v1` suffix still required)
  to run in live mode instead of standalone/mock.

## 16. Next authorized step

Operator creates the DNS records (`license.casazium.com`,
`license-api.casazium.com`, pointed at their respective VPS IPs) and the
two Coolify resources, using the compose files merged in §14/§15 above and
each file's own header comment for the required env var list. After that:
a real `docker build` once registry access is available, to close the one
verification gap noted in §14; and the license detail page
(`/licenses/[key]`) still hasn't had its own dedicated UI review pass, the
remaining open thread from the page-by-page review.
