# PROJECT_STATUS.md — license-console

Status: Draft
Last updated: 2026-08-04 (relocated the SaaS-tier plan, its review, and
its task breakdown to `casazium/license`'s own PROJECT_STATUS.md — see §29)

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
  designed not to block on this (§3). §9 deferred multi-account specifically
  until "multiple consoles/admins share one backend" became a real
  requirement rather than a hypothetical — the SaaS-tier plan in §29 is
  exactly that requirement, and folds multi-account login into its
  SaaS-B1 task rather than treating it as a separate deferred item.

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

(A `DB_FILE` persistence bug was found and fixed in `casazium/license`'s
local-dev-only `docker-compose.yml` - see `casazium/license#28`. It did
not affect the Coolify deployment path above, which already used the
correct env var name.)

## 16. Coolify milestone closed (2026-08-02)

All four PRs that make up the "get a live POC reachable via Coolify"
milestone (§14/§15) are merged:

| PR | Repo | Content |
|---|---|---|
| `#8` | `license-console` | Dockerfile, standalone build, `docker-compose-coolify.yml` |
| `casazium/license#27` | `license` | `docker-compose-coolify.yml` |
| `#9` | `license-console` | Deployment topology confirmed (domains, one-instance-two-servers) |
| `casazium/license#28` | `license` | `DB_FILE` persistence bug fix, surfaced while confirming the backend was safe to depend on for the live POC (§15's cross-reference note) |

What this milestone did and didn't cover, to avoid later confusion:

- **Covered:** every piece of code/config this repo and `casazium/license`
  needed to *be deployable* to Coolify - Dockerfiles, Coolify-specific
  compose files, the mode-detection mechanism (§13) that lets this console
  run standalone/mock or live off the same image depending on which env
  vars Coolify is given, and the confirmed domain/topology shape.
- **Not covered, and not something this session does:** actually creating
  DNS records or the two Coolify resources themselves. That's the
  operator's own manual action against their Coolify dashboard and DNS
  provider, tracked as the next step below rather than as part of this
  milestone's definition of done.

## 17. License detail page review closed (2026-08-02)

Last open thread from the original page-by-page UI review (§9-§11
covered login, dashboard, licenses list). Reviewed `/licenses/[key]`
directly against a running instance (mock mode, Playwright) rather than
from a code read alone. Two findings, both fixed:

- **No seat-utilization indicator**, unlike the licenses list page's
  color-coded Seats badge (red at 0 remaining, yellow at 1). The detail
  page only showed a bare "Max activations" number, forcing a manual
  count of the Activations table below to see remaining seats. Added the
  same badge here.
- **Reissue token wasn't brand-colored**, unlike other primary actions
  (Issue License, pagination) - it rendered as Mantine's default blue
  via the `subtle` button variant.

The Reissue token fix needed a real correction mid-pass, not just a
style tweak: Mantine's `subtle` variant renders its color via
`--button-color` with a transparent `--button-bg` - reusing the existing
`brandButtonStyle` (which overrides `--button-bg`) would have painted a
solid brand-colored background behind the text instead of just
recoloring it. Added `brandTextButtonStyle` in
`components/brandButtonStyle.ts` for text-only variants (subtle,
outline) as a sibling to the existing filled-button style, rather than
overloading one style object for both cases.

Also caught and fixed a hydration error introduced while building the
seats badge: nesting a `Badge` (renders `<div>`) inside a `Text`
(renders `<p>`) is invalid HTML. Switched to a `Group` wrapper. Verified
end-to-end: Playwright walkthrough with a distinct `BRANDING_COLOR`
confirmed Reissue token renders as brand-colored text with no background
fill and no console/hydration errors, plus a clean `npm run lint` and
`npm run build`. Committed and pushed directly to `main` (`e019b34`),
skipping the branch+PR step every prior UI code change in this session
used (§9-§13's login/dashboard/licenses-list passes, §14's Coolify
packaging) - not a deliberate convention change, just how this pass
happened to go. Worth reverting to branch+PR for the next code change
unless the operator says otherwise.

## 18. Pre-deployment security audit (2026-08-02)

A pre-deployment security audit covered this repo alongside
`casazium/license`'s own H1/H2 backend findings (see that repo's own
history). Three fixes, all committed directly to `main` (`e1d44cd`,
`b715a98`, `2b08863`) - continuing, not reverting, §17's departure from
the branch+PR convention used through §9-§14.

- **Brute-force login protection** (`e1d44cd`). The login route had no
  rate limiting at all - verified live, 20 consecutive wrong-password
  attempts all returned plain 401s with no throttling. One shared admin
  password with unlimited online guessing meant the whole system's
  security reduced to that password's entropy. Added a 5-attempts/15-
  minute in-memory rate limiter keyed on the client's forwarded IP
  (`lib/login-rate-limit.ts` - adequate for this single-replica
  deployment; a multi-replica one would need a shared store instead),
  plus constant-time credential comparison in `lib/auth.ts` to close the
  secondary timing side-channel on the character-by-character `!==`
  check. Verified live against the audit's exact test: 20 consecutive
  wrong attempts now block after the 5th (401×5, 429×15); lockout also
  blocks the correct password while active; `Retry-After` header
  present; a fresh client is unaffected; success resets the bucket.
- **Non-root container user** (`b715a98`). The runner stage ran as root.
  The Next.js standalone output already prunes to only the
  `node_modules` subset the server bundle needs, so no dependency
  trimming was needed - just `--chown=node:node` on the copy steps and
  `USER node`. Server is stateless (no writable data dir), so no
  separate `chown` step either. Not verified: actual non-root runtime
  permission behavior (no Docker daemon available in that session) -
  functional behavior confirmed, container-level permission enforcement
  was not (later superseded by real Coolify deployment - see §22).
- **Four medium-priority findings** (`2b08863`):
  - Server actions (`app/(app)/licenses/actions.ts`) had no auth check
    of their own - `proxy.ts`'s middleware never runs for action
    invocations, only page/route navigation. Not currently exploitable
    on Next 16.2.12 (action IDs are scoped to the pages that bundle
    them), but that's a Next internal, not a guarantee. Added
    `requireSessionForAction()` (`lib/session.ts`) to all four actions.
  - `getBackendMode()` silently resolved to mock mode whenever
    `LICENSE_API_URL`/`LICENSE_ADMIN_API_KEY` were both unset - the
    documented way to deploy an intentional standalone/demo instance,
    but indistinguishable from an operator forgetting to configure live
    mode. Now requires an explicit `LICENSE_STANDALONE_MODE=true` in
    production to confirm mock mode was intentional; dev/test keep the
    zero-config default.
  - `next.config.mjs` defined no security headers at all. Added
    `X-Frame-Options`, `X-Content-Type-Options`, HSTS, `Referrer-Policy`,
    and a CSP. The first CSP attempt (`script-src 'self'`) broke the app
    entirely - Next's own inline hydration/bootstrap scripts need inline
    execution, so login hung forever with the script silently blocked.
    Relaxed to `'unsafe-inline'` for both `script-src` and `style-src`
    (the latter for Mantine's runtime style injection); a fully strict
    `script-src` would need per-request nonces, a much larger change
    than this pass (the dev-mode follow-up to this CSP is §19's
    `a27063b`).
  - `SESSION_SECRET` accepted any non-empty string. Now requires at
    least 32 characters.

  Verified together against a real production standalone server
  (`node .next/standalone/server.js`, not dev mode, since the mode-fix
  is production-gated): full login → dashboard → licenses walkthrough
  with zero console errors after the CSP fix; `LICENSE_STANDALONE_MODE`
  fail-loud (missing) and fail-safe (present) behavior both confirmed
  live; security headers present on responses; a real authenticated
  revoke action still works end-to-end with the new action guard in
  place; an unauthenticated direct POST to a real extracted action ID
  is caught (redirected to `/login`).

## 19. Dependency, dev-environment, and standalone-server fixes (2026-08-03)

Four independent fixes, each merged as its own PR (`#10`-`#13`):

- **`#10` - npm audit overrides.** `npm audit` flagged 3 high-severity
  findings, all rooted in `next@16.2.12` (the latest published stable
  release, so no version bump was available): its internally
  exact-pinned `postcss@8.4.31` (XSS/path traversal advisories) and its
  optional dependency `sharp@^0.34.5` (inherited libvips CVEs). Added
  root-level `overrides` forcing the already-patched `postcss@^8.5.25`
  and a patched `sharp@^0.35.3` across the whole tree, including next's
  own vendored copies. `next/image` (the only consumer of `sharp`) isn't
  used anywhere in this app (`components/BrandLogo.tsx` uses a plain
  `<img>`), so this was precautionary rather than closing an active
  exposure. Verified: `npm audit` reports 0 vulnerabilities, build and
  lint both clean.
- **`#11` - CSP eval() scoped out of development.** §18's CSP applied
  `script-src 'self' 'unsafe-inline'` unconditionally, which silently
  broke local development - Next's dev server (Fast Refresh, dev-mode
  stack traces) calls `eval()` to do its job, and the browser blocked it
  ("eval() is not supported in this environment"). Next never calls
  `eval()` in a production build, so `'unsafe-eval'` is now scoped to
  non-production via `NODE_ENV`, leaving the production policy
  unchanged. Verified: dev server's CSP header includes `'unsafe-eval'`;
  a production build + `npm start` still serves the original, stricter
  policy without it.
- **`#12` - `npm run start` fixed for `output: standalone`.**
  `next.config.mjs` sets `output: 'standalone'` (required by the
  Dockerfile), which `next start` doesn't support - it printed a warning
  and served an incomplete app, since standalone builds intentionally
  omit `public/` and `.next/static`. Added a postbuild step
  (`scripts/copy-standalone-assets.mjs`, `fs.cpSync`-based so it works
  on any OS) that copies both into `.next/standalone/`, and pointed
  `start` at `node .next/standalone/server.js` directly. Docker was
  unaffected - its own multi-stage build already copies both from their
  original locations independently. Verified: `npm run build && npm run
  start` boots cleanly with no standalone warning, `GET /login` returns
  200 with all security headers intact.
- **`#13` - `.env` files copied into the standalone output.** Follow-up
  to `#12`: `.next/standalone/server.js` does `process.chdir(__dirname)`
  before Next's own env-file loading runs, so `.env.local` (and
  `.env`/`.env.production`/`.env.production.local`) at the project root
  were invisible to it - `ADMIN_UI_USERNAME`/`ADMIN_UI_PASSWORD`/
  `SESSION_SECRET` etc. all silently stopped loading even though they
  were set correctly. Reproduced directly: with a real `.env.local`
  present, login returned 500 ("Missing required environment variable:
  ADMIN_UI_USERNAME or ADMIN_UI_PASSWORD"). Fixed by copying Next's
  production env-file set into `.next/standalone/` alongside
  `server.js`. Verified: the same login now returns 200 with a session
  cookie, using only `.env.local` (no shell-exported vars).

## 20. Backend N+1 fix wired in (2026-08-03)

`#14`. Follow-up to `casazium/license`'s
`perf/list-licenses-activations-count`: `GET /list-licenses` now returns
`activations_count` per row (a server-side correlated subquery), so
`listLicenses()` and `getLicensesNearSeatLimit()` no longer need their
own `GET /list-activations/:key` call per license - closing the real N+1
cost accepted as a known tradeoff back in §13.

`activations_count` is scoped to a new `RawLicenseListRow` type
(`License & { activations_count }`) rather than added to the base
`License` type - `GET /admin/license/:key` (used by `getLicense`) has no
such field, and adding it to `License` would have made that call site's
return type claim a field the real response never has.
`listActivations()` and its one remaining real caller (the license
detail page, which needs the actual activation list, not just a count)
are unchanged.

Verified end-to-end against a real `casazium/license` instance using its
rate-limit response headers as an exact request counter: a dashboard
load dropped from 9 admin-bucket requests to 4, and critically that 4 no
longer scales with license count the way the old N+1 pattern did.
Confirmed the seat-utilization numbers are still correct, not just
faster, by seeding a license with 2/3 activations used and checking the
rendered "Seats near capacity" widget showed `used: 2, max_activations:
3, remaining: 1`.

## 21. Remaining branding gaps and Coolify hostname binding fix (2026-08-03)

Three small fixes, each merged as its own PR (`#15`-`#18`):

- **`#15`/`#16` - two remaining unbranded buttons.** `brandButtonStyle`/
  `brandTextButtonStyle` was already the established pattern for primary
  CTAs, but an audit of every `Button` in the app against that
  convention found two gaps: the "Issue license" form's own submit
  button (`#15`, fell back to Mantine's default blue instead of
  `BRANDING_COLOR`) and the "Sign out" button (`#16`, structurally
  identical to the already-branded "Reissue token" button but had no
  styling at all - unlike Revoke/Delete/Cancel, it isn't destructive or
  a dismiss action, so there's no reason to exclude it like those are
  deliberately excluded). Everything else checked out as already
  correctly branded or correctly neutral. Verified visually with
  `BRANDING_COLOR=#16a34a`: both buttons render green.
- **`#17` - standalone server bound to the wrong hostname in Docker.**
  `.next/standalone/server.js` binds to `process.env.HOSTNAME ||
  '0.0.0.0'` - but Docker automatically sets `HOSTNAME` to the
  container's own short ID for every container, so that fallback never
  triggers. Left unset, the server ends up bound to that container-ID
  hostname instead of all interfaces, unreachable by this app's own
  healthcheck (`http://127.0.0.1:3000/login`) or by external routing
  through Coolify/Traefik. Reproduced directly: setting `HOSTNAME` to a
  container-ID-like value reproduces the exact `Local:
  http://<container-id>:3000` log line and makes `127.0.0.1`
  unreachable; setting `HOSTNAME=0.0.0.0` fixes both. Set as `ENV
  HOSTNAME=0.0.0.0` in the Dockerfile (baked into the image) and
  reinforced in `docker-compose-coolify.yml`'s environment list in case
  Coolify's own env injection ever takes precedence over the image-baked
  value.
- **`#18` - doc correction, not a code bug.** `.env.example` claimed
  `BRANDING_TITLE_HTML` shows "on the login page and in the app header,"
  but `AppShellClient.tsx`'s header only ever renders `BrandLogo` - a
  full-app grep confirmed `app/login/page.tsx` is the only call site.
  Confirmed the component itself works correctly (a real production
  build's computed style matched `BRANDING_COLOR` exactly), so the bug
  was the documentation's claim, not the code. Corrected the comment.

## 22. Production debugging: hydration mismatch, admin rate-limit exhaustion, and branding-color quoting (2026-08-03)

Operator reported the deployed Coolify instance (`license.casazium.com`)
was missing both the "Issue license" button and the branding color,
despite both working correctly in local dev and in a local production
build. Three distinct, unrelated root causes, found and fixed across
this and the prior conversation segment:

- **`#19` - React #418 hydration mismatch from locale-dependent date
  formatting.** `LicensesTable.tsx` and `LicenseActions.tsx`'s
  `ActivationsTable` are both `'use client'` components calling
  `toLocaleDateString()`/`toLocaleString()` with no fixed locale/time
  zone - since client components render once server-side (container
  locale) and again client-side during hydration (browser locale), a
  visitor whose browser locale differs from the server's crashed with a
  React #418 hydration-mismatch error that unmounted the table's sibling
  content, including the "Issue license" button. Rigorously verified
  with a before/after Playwright repro using a deliberately
  locale-mismatched browser context (`locale: 'de-DE', timezoneId:
  'America/Los_Angeles'`) - reproduced the exact error on old code, zero
  errors after pinning both call sites to `'en-US'` + `timeZone: 'UTC'`.
  **Confirmed real and independently valuable, but not this operator's
  actual production symptom** - their browser locale likely already
  matched the server's, so this specific mismatch never fired for them;
  the button was still missing after this fix deployed.
- **Admin rate-limit exhaustion (not a code bug).** The real symptom:
  `GET /licenses` returned a genuine 500, with the server's own runtime
  log showing `Error: Failed to list licenses: 429 Too Many Requests`.
  `casazium/license`'s admin-bucket rate limit (50 requests/15 min, keyed
  per IP) was being exhausted by the debugging session's own repeated
  testing/reloading - and because `license-console`'s server, not each
  admin's browser, is the actual caller against those endpoints, the
  whole admin team sharing one console deployment shares a single
  IP-keyed bucket, sized more for a single slow human than a multi-call
  admin console. Fixed on the `casazium/license` side: the limit is now
  configurable via `ADMIN_RATE_LIMIT_MAX` (default raised to 300,
  matching the existing "license activation" tier) - see
  `casazium/license#38` (merged).
- **`#20` - `BRANDING_COLOR` quote-stripping.** Even after both fixes
  above, the button stayed invisible. Root cause: `BRANDING_COLOR` was
  set with literal wrapping double quotes (matching `.env.example`'s
  dotenv-quoting example, e.g. `"#2563eb"`), but Coolify's env-var UI
  passes values through verbatim - no shell/dotenv-style quote stripping
  like a `.env` file gets. The quote characters became part of
  `--brand-color`, turning it into a CSS `<string>` instead of a
  `<color>`; every `var(--brand-color)` substitution went invalid at
  computed-value time, so `background-color` silently fell back to
  `transparent` - a white-on-transparent (invisible) button. Reproduced
  and confirmed via Playwright: computed `background-color` was
  `rgba(0,0,0,0)` with the quoted value, `rgb(37,99,235)` after the fix.
  Fixed by stripping a single layer of wrapping quotes for
  `BRANDING_COLOR` in `lib/branding.ts` (handles both quoted-`.env`-file
  and unquoted-platform-UI input); corrected `.env.example`'s guidance
  to clarify the quoting is a `.env`-file convention, not something to
  type into a platform's env-var UI.
- **`#21` - Coolify's "Is Literal" checkbox.** Operator found a second,
  deployment-side cause behind the same symptom: Coolify's environment
  variables UI has a per-variable "Is Literal" checkbox that must be
  enabled for `BRANDING_TITLE_HTML` and `BRANDING_COLOR` - left off,
  Coolify reprocesses the value before injecting it into the container,
  corrupting both (the quoting bug above was one concrete way this
  showed up). Documented in `.env.example` and
  `docker-compose-coolify.yml`, matching each file's established pattern
  of noting Coolify-specific quirks inline.

Net result: production `license.casazium.com` now shows the "Issue
license" button and the configured branding color correctly, verified
by the operator directly.

## 23. Expires-at split into date/time/timezone fields (2026-08-03)

Operator reported the "Issue license" form's single `expires_at` field -
a raw text input requiring hand-typed ISO 8601 (`2027-01-01T00:00:00Z`) -
was "extremely hard" to use in practice. Split into three fields that
compose into that same ISO string on submit, rather than asking the
operator to produce it directly:

- **Expires on** - `@mantine/dates`' `DateInput`, defaults to today.
- **At** - `@mantine/dates`' `TimeInput`, defaults to midnight (`00:00`).
- **Time zone** - a `Select` of common US zones (Eastern, Central,
  Mountain, Pacific, UTC), defaulting to Eastern per operator preference.
  Deliberately not an exhaustive IANA list - scoped to the realistic
  operator base for a US-run license console.

Added `@mantine/dates` as a new dependency - required bumping the whole
`@mantine/*` family (`core`/`form`/`hooks`/`notifications`) from `9.5.0`
to `9.5.1` in lockstep, since `@mantine/dates@9.5.1`'s peer dependency
strictly requires `@mantine/core@9.5.1` exactly. `npm audit`: 0
vulnerabilities after the bump.

The three fields compose into the backend's expected ISO string via a
new `lib/timezone.ts` helper (`zonedDateTimeToIso`) rather than pulling
in a timezone-data library (`dayjs`'s timezone plugin, `date-fns-tz`,
etc.) - a small, self-contained implementation of the standard two-pass
`Intl.DateTimeFormat` technique (treat the wall-clock numbers as a UTC
guess, read back what that guess displays as in the target zone to
recover its current offset, then apply the offset in reverse) correctly
accounts for DST on the given date using the runtime's own IANA
database, with no added dependency surface. `issueLicenseAction`'s
contract (`expires_at: string`, ISO 8601) is unchanged - composition
happens entirely in the form's submit handler.

Verified: the offset helper directly against known cases (EST `UTC-5`
in January, EDT `UTC-4` in July, CST/MST/PST, and UTC itself - all
correct); `npm run lint` and `npm run build` both clean; a live
Playwright walkthrough against a production build confirmed the
defaults render correctly (today's date, `00:00`, "Eastern (ET)") and
that submitting a license with an explicit date/time/zone produces the
correct expiration date on the resulting license.

## 24. Build-time version stamp in both footers (2026-08-03)

Operator asked for a version number somewhere on the console, for a
reason directly motivated by this session's own Coolify deploy-freshness
confusion (§22): confirming what's actually running without cross-
checking commit SHAs by hand. Recommended, and built, both a semver
label (`package.json`'s `version`, human-friendly) and the git commit
SHA (always accurate, zero maintenance) rather than picking one -
semver as the visible text, SHA as a hover tooltip.

Computed once at build time in `next.config.mjs`'s `env` block (`git
rev-parse --short HEAD`, read via `execSync`, falling back to `'unknown'`
if `.git` isn't present rather than failing the build) - not at request
time, since the Docker runner stage never has `.git` available (only
`.next/standalone`, `public/`, and `.next/static` are copied into it).
The Dockerfile's builder stage does have it (`COPY . .` happens before
`.git` would be excluded, and there's no `.dockerignore`), so this works
for the real Coolify build path, not just local dev.

New `lib/version.ts` (`getAppVersion()`) and `components/VersionStamp.tsx`
render `v{version}` with `title="commit {sha}"`. Added to both footers -
`app/login/page.tsx` (previously only rendered when
`BRANDING_COPYRIGHT_HOLDER` was set; now always renders) and
`app/(app)/AppShellClient.tsx` (same change, plus the `AppShell` `footer`
prop is now unconditional rather than `branding.copyrightHolder ?
{ height: 36 } : undefined`) - separated from the copyright line by a
middot when both are present.

Verified: `npm run lint` and `npm run build` both clean; build output
confirmed `APP_VERSION`/`GIT_SHA` baked into `next.config.mjs`'s embedded
config matched `package.json` and the actual current `HEAD` short SHA
exactly; a live Playwright walkthrough against a production build
confirmed both footers render `v0.1.0` with the correct commit in the
tooltip, on both `/login` and the authenticated app shell.

## 25. Consistent date/time formatting via a shared helper (2026-08-03)

Operator spotted a real bug by comparing two screenshots: the same
activation's "Activated at" showed `1:06:11 AM` on the dashboard and
`5:06:11 AM` on that license's own detail page - a 4-hour gap for one
event. Root cause, confirmed by grepping every date-display call site in
the app: only 2 of 8 (`LicensesTable.tsx`'s "Expires" column and
`LicenseActions.tsx`'s `ActivationsTable`, both from the §22 hydration-
mismatch fix) were pinned to `'en-US'`/UTC. The other 6 - all three
dashboard tables (`RecentActivationsTable`, `ExpiringLicensesTable`,
`RecentlyIssuedLicensesTable`) and the license detail page's own "Issued
at"/"Expires at"/"Revoked at" lines - called `toLocaleString()`/
`toLocaleDateString()` unpinned, rendering in whichever locale/timezone
happened to apply at that call site. Each new component since §22 had
been re-implementing the same formatting inline instead of sharing one
convention, so the fix drifted out of sync with itself as the app grew.

Extracted `lib/format.ts` (`formatDate`/`formatDateTime`) and switched
all 8 call sites to it - including the 2 already-correct ones, removing
their now-redundant inline comments in favor of one shared explanation
covering both the hydration-safety reason (§22) and the
cross-page-consistency reason (this bug) `lib/format.ts` itself
documents. Every date/time in the app now goes through one of these two
functions; there's no longer an inline
`toLocaleString()`/`toLocaleDateString()` call anywhere else in the
codebase to accidentally re-diverge from.

Follow-up, same session: operator noticed the fix's initial format
(`'en-US'` locale, e.g. `7/19/2026, 3:52:41 PM`) didn't match the
"Issue license" form's own `DateInput` (`valueFormat="YYYY-MM-DD"`,
§23) - a second, narrower inconsistency between the input format and
the display format. Switched both functions to build from
`toISOString()` instead of `Intl.DateTimeFormat` options - `YYYY-MM-DD`
for `formatDate`, `YYYY-MM-DD HH:mm:ss` for `formatDateTime` -
unambiguous regardless of the reader's own locale, sorts correctly as
plain text, and now matches the form's own format exactly.
`toISOString()` is always UTC and always zero-padded, so no
locale/timeZone options are needed at all anymore.

Verified: `npm run lint` and `npm run build` both clean; a live
Playwright walkthrough against a production build reproduced the exact
scenario from the operator's screenshots - the same activation's
"Activated at" now reads identically (`2026-07-19 15:58:47`) on both
the dashboard and its license detail page - cross-checked a "Recently
issued" date-only dashboard cell against the matching detail page's
full timestamp to confirm the date portions agree, and confirmed every
date/datetime across the dashboard, licenses list, and detail page now
reads in the same `YYYY-MM-DD`/`YYYY-MM-DD HH:mm:ss` format as the
"Issue license" form's own date picker.

## 26. Friendly rate-limit message instead of a crash (2026-08-03)

Operator, testing production in Coolify: hitting the admin rate limit
(§22) shouldn't "throw up an error" - wanted a proper "try again later"
message instead. Before implementing, verified an important
architectural constraint empirically rather than assuming: built a
throwaway Server Action that threw a plain `Error` with a distinctive
message, called it from a Client Component in a real production build,
and read what the client actually received. Confirmed Next.js redacts
thrown-error details (message, name, any custom properties) to a
generic "An error occurred..." message plus an opaque `digest` once an
error crosses *either* a Server Component render boundary *or* a Server
Action's return - not just the page-render case §22 already knew about.
This ruled out the obvious approach (throw a typed error, let a client
component's catch block inspect its `status`) for both surfaces.

Built accordingly - detection has to happen server-side, before either
boundary, or the status information is lost:

- `lib/errors.ts`: `LicenseApiError` (carries the real HTTP `status`)
  and `isRateLimited()`. `lib/license-client.live.ts`'s 8 `!res.ok`
  branches now throw this instead of a plain `Error`.
- The three data-fetching Server Component pages (`dashboard/page.tsx`,
  `licenses/page.tsx`, `licenses/[key]/page.tsx`) now catch inline and
  render a shared `<RateLimitNotice />` (a Mantine `Alert`) instead of
  the normal content when `isRateLimited()` - any other error still
  throws unchanged, so this stays scoped to the one expected condition
  rather than becoming a general error-UX redesign.
- `app/(app)/licenses/actions.ts`'s four Server Actions
  (issue/revoke/delete/reissue) now catch internally and return a
  structured `{ ok: true, data } | { ok: false, rateLimited: true }`
  instead of throwing - the "expected errors as return values" pattern,
  now confirmed necessary rather than just a Next.js docs suggestion.
  Their three client call sites show a shared `notifyRateLimited()`
  toast (`lib/notify.ts`) on the `rateLimited` case.
- Fixed a latent, unrelated bug found while touching this code:
  `RevokeDeleteActions`'s revoke/delete handlers had no error handling
  at all - any failure left the button stuck in its loading state
  forever with no feedback. Now wrapped in try/catch/finally alongside
  the rate-limit handling, matching the pattern already used by the
  "Issue license" form.

Verified: `npm run lint` and `npm run build` both clean. Live-tested
against a stub HTTP server that always returns 429 (LICENSE_API_URL
pointed at it) rather than waiting on a real rate-limit window:
confirmed the dashboard, licenses list, and license detail page all
show the friendly notice with zero uncaught page errors, and that
submitting the "Issue license" form against the same stub shows the
"Too many requests" toast and stays on the form instead of crashing.

## 27. Label full timestamps with their timezone (2026-08-03)

Operator flagged a real gap while reviewing a screenshot: "Activated at"
(and every other full timestamp - Issued at, Expires at, Revoked at)
showed a bare value like `2026-08-03 05:06:11` with no timezone at all,
which reads as the viewer's own local time by default even though it's
always UTC (§25). Confirmed the intent before changing anything - "UTC"
is the correct, truthful label (not a placeholder like the operator's
own example of "IST"), since that's what the underlying value actually
is.

`formatDateTime` now appends a literal `UTC` suffix
(`2026-08-03 05:06:11 UTC`). `formatDate` (bare dates, no clock time -
the "Expires" column on the licenses list, the dashboard's date-only
cells) is unchanged - the operator's complaint and the screenshot were
specifically about a *time* being unlabeled, not a date.

Explicitly scoped as a stopgap, not the real fix: the real fix is a
per-admin timezone preference (a profile settings page, not built yet)
so every admin sees times in their own zone instead of mentally
converting from UTC - noted in code as a follow-up, not attempted here.

Verified: `npm run lint` and `npm run build` both clean; a live
Playwright walkthrough confirmed every full timestamp across the
dashboard, licenses list, and license detail page now reads
`YYYY-MM-DD HH:mm:ss UTC` consistently, while date-only cells are
unchanged.

## 28. Freeform notes on licenses, editable after issuance (2026-08-03)

Operator asked for a way to attach internal context to a license
("renewed via phone call", "beta customer") - confirmed upfront that
notes should be editable after issuance too, not just captured once at
creation. Console side of a cross-repo change - `casazium/license#39`
added the backend `notes` column, `POST /issue-license`'s optional
`notes` field, `GET /admin/license/:key`'s `notes` in its response, and
a new `POST /admin/update-notes` endpoint.

- `lib/license-types.ts`: `License.notes: string | null`,
  `IssueLicenseInput.notes?: string`.
- `lib/license-client.live.ts`: `issueLicense`/`getLicense` needed no
  changes (they already pass through/return the full payload); added
  `updateLicenseNotes(key, notes)` calling the new endpoint. Mirrored in
  the mock client, plus sample notes seeded on a few demo licenses for a
  more realistic standalone-mode look.
- `app/(app)/licenses/actions.ts`: new `updateLicenseNotesAction`,
  following §26's established rate-limit-safe pattern (catch
  `LicenseApiError`, return a structured result instead of throwing).
- "Issue license" form: optional `Notes` `Textarea`.
- License detail page: new `NotesEditor` component
  (`LicenseActions.tsx`) - shows the current note (or "No notes yet.")
  with an Edit/Add note button that swaps in a `Textarea` + Save/Cancel;
  updates its own local state on a successful save rather than needing
  a `router.refresh()`, matching this component's self-contained scope.

Verified end-to-end, not just via lint/build: `npm run lint` and
`npm run build` both clean. Standalone (mock) mode: confirmed seeded
notes display correctly, editing an existing note persists and
displays immediately, "Add note" works for a license with none, and
issuing a new license with a note from the form shows it correctly on
the resulting detail page. **Also verified against the real backend**,
matching this session's practice for cross-repo changes (§13) rather
than trusting the mock/live split alone: ran a real local
`casazium/license` instance on the `feat/license-notes` branch,
`curl`-confirmed the full backend round-trip directly (issue with
notes -> `GET /admin/license/:key` returns it -> `POST
/admin/update-notes` -> confirmed updated), then pointed a live-mode
console build at that same real instance and repeated the issue+edit
flow through the actual UI - zero console errors, notes correctly
persisted through real HTTP calls both ways.

## 29. SaaS tier: relocated to `casazium/license` (2026-08-04)

A hosted multi-tenant SaaS tier alongside (not replacing) the self-hosted
product was scoped, adversarially reviewed (Opus), and given a revised
task breakdown in this section (originally §29, §31–34) on 2026-08-04.

**Relocated to `casazium/license`'s own `PROJECT_STATUS.md`** the same
day, on reconsideration — the actual risk in that plan (tenant isolation,
the auth boundary, schema changes) is overwhelmingly server-side, and
nearly every finding in its review was about that repo, not this one.
Full content, including this repo's own tasks (`SaaS-B1a`–`B5`) as part
of the whole plan, now lives there. See `casazium/license/PROJECT_STATUS.md`
§1 for the relocation note and §2–6 for the plan itself.

**Nothing in it is authorized to begin implementation.**

## 30. SaaS-B1a: persistence layer (2026-08-05)

First implementation task from the plan §29 points at. Full decision
rationale (SQLite vs. Postgres, migration strategy, connection
lifecycle) lives in `casazium/license/PROJECT_STATUS.md` §33, matching
§29's own convention of keeping the plan's authoritative narrative
there. This entry is this repo's own build record.

Branched `saas-tier` from `main` for this and all following `SaaS-B*`
work (§5 of the plan doc: a long-lived branch, not merged until a go
decision) — found local `main` and the true `origin/main` had diverged
(a stale `git fetch` cache masked this at first; `git ls-remote`
and the push itself both surfaced the real state), resolved by
fast-forwarding local `main` to `origin/main`'s actual tip
(`feat/license-notes-ui`'s PR #29 merge) before branching, not by
force-pushing over anything.

### What was built

- **`lib/db.ts`** — SQLite connection via `better-sqlite3`, matching
  `casazium/license`'s own choice. `journal_mode = WAL` and
  `foreign_keys = ON` set on open. A `globalThis`-stashed singleton, the
  standard Next.js pattern for surviving dev-mode Fast Refresh re-running
  module top-level code without leaking file handles across saves.
- **`lib/db/schema.sql`** — empty shell (a header comment only) applied
  via `db.exec()` on every open, same `CREATE TABLE IF NOT EXISTS`
  convention as `casazium/license`'s `src/app.js`/`src/db/schema.sql`, no
  migration framework. No application tables yet — `SaaS-B1b`/`B1c` add
  them.
- **`next.config.mjs`** — `serverExternalPackages: ['better-sqlite3']`,
  required because it's a native addon (compiled `.node` binary); without
  this Next's bundler would try to webpack it.
- **`scripts/copy-standalone-assets.mjs`** — extended to also copy
  `lib/db/schema.sql` into `.next/standalone/lib/db/`, for the same
  reason it already copies `public/`/`.next/static`: the standalone
  tracer only follows the JS import graph, not a runtime
  `fs.readFileSync()` path to a non-JS file.
- **`Dockerfile`** — `RUN mkdir -p /app/data && chown -R node:node /app`
  before `USER node`, mirroring `casazium/license`'s own Dockerfile
  exactly, so the Coolify volume mounted at `/app/data` inherits
  writable ownership. The old "this server is stateless" comment is no
  longer true and was removed.
- **`docker-compose-coolify.yml`** — `DB_FILE=/app/data/console.db` env
  var and a `console-data` named volume, mirroring
  `casazium/license`'s `license-data` volume convention exactly. The
  existing healthcheck still targets `/login`, not this DB — left
  unchanged, wiring a DB check into it is an easy independent follow-up,
  not done here to keep this task's scope to what `SaaS-B1a` actually
  asked for.
- **`app/api/health/db/route.ts`** — not wired into Coolify's healthcheck
  (see above); exists purely to prove the connection lifecycle end-to-end
  during this task, since it isn't otherwise exercised until `B1b`/`B1c`
  add real tables.
- **`.env.example`**, **`README.md`**, **`.gitignore`** — `DB_FILE`
  documented; local dev DB files (`/data/`, `*.db*`) ignored.

### A real risk, checked rather than assumed

`node:22-alpine`'s musl libc is a different ABI than the glibc
`node:20-slim` `casazium/license` uses for the same dependency — a
musl-incompatible native binary would only surface as a Docker build
failure, not a local `npm install` failure, in this exact sandbox (no
Docker daemon available to build the image directly here). Checked the
actual `better-sqlite3@11.10.0` GitHub release assets instead of
guessing: `linuxmusl-x64` prebuilds exist for Node ABI v127 (Node 22's
ABI), so no extra Alpine build tooling (`python3`/`make`/`g++`) was
added. **Still not a substitute for an actual `docker build` — recommend
running one before this ships to Coolify**, since this is inference from
published release assets, not a direct build confirmation.

### Verified

- `npm run lint` — clean.
- `npm run build` (Turbopack) — compiles, passes TypeScript, all 9
  routes generated including the new health route. Turbopack initially
  warned that `lib/db.ts`'s `DB_FILE`-derived path resolution looked
  dynamic enough to trace the whole project as a dependency of the
  health route ("Encountered unexpected file in NFT list") — fixed with
  the `turbopackIgnore` comment Next's own warning message suggests,
  confirmed by rebuilding clean with the warning gone.
- Ran the actual `.next/standalone/server.js` (not `next dev` — the real
  artifact Docker ships), logged in via `/api/login`, called the new
  authenticated `/api/health/db` route: `{"ok":true,"journalMode":"wal","foreignKeys":1}`,
  and confirmed the SQLite file was created on disk at the configured
  `DB_FILE` path with the schema applied without error.
- Not run: an actual `docker build` (no daemon in this sandbox) and a
  live dev-mode Fast-Refresh reload check (the `globalThis` singleton
  pattern is standard/well-established; not independently re-verified
  here beyond code review).

## 31. SaaS-B1b: accounts, signup, login (2026-08-05)

Two real design gaps surfaced before writing code, both confirmed with
the operator rather than assumed (full rationale in
`casazium/license/PROJECT_STATUS.md` §35):

1. `lib/auth.ts`'s own docstring anticipated swapping `verifyCredentials()`
   wholesale to a real user store - wrong for self-hosted, which has
   exactly one operator and no use for signup/accounts at all. Resolved
   by adding a console-side `MULTI_TENANT` flag (`lib/config.ts`,
   mirroring `casazium/license`'s own): off, `verifyCredentials()` is
   byte-identical to today; on, it checks the new `accounts` table.
2. Password-reset needs to email a reset link - no email-sending
   capability exists anywhere in this repo (checked: `lib/notify.ts` is
   Mantine toast UI, not email; no email dependency in `package.json`).
   Deferred rather than picking a provider unprompted - this task ships
   signup + login only.

### What was built

- **`lib/db/schema.sql`** — `accounts` table (`id`, `email`,
  `password_hash`, `tenant_id`, `tenant_api_key_encrypted`, `created_at`),
  unique index on `email` added separately rather than inline (matching
  `casazium/license`'s own `idx_tenants_api_key_hash` convention).
  `tenant_id` stored as a plain column, not derived by decrypting the key
  on every read, so `SaaS-B1c`'s session work can carry it without a
  decrypt per request. Multiple accounts sharing one `tenant_id` (team
  invites) is schema-compatible but not built here.
- **`lib/password.ts`** — scrypt via Node's own `crypto`, not a
  third-party dependency (bcrypt/argon2). Both ship native addons, the
  same class of Alpine/musl risk `SaaS-B1a` already worked through once
  for `better-sqlite3` - not worth taking on twice when Node's built-in
  is the documented standard for this exact use case.
- **`lib/crypto.ts`** — AES-256-GCM, same algorithm and wire format as
  `casazium/license`'s own `src/lib/crypto.js`, but a deliberately
  separate `ACCOUNT_ENCRYPTION_KEY` - reusing that repo's key across two
  independently deployable services would be an unintended cross-service
  credential coupling, not a simplification.
- **`app/api/signup/route.ts`** — 404s under self-hosted (mirrors
  `casazium/license`'s own `create-tenant.js` posture under
  `!isMultiTenant()`). Provisions a new tenant server-to-server via
  `POST /admin/tenants` using this console's own `LICENSE_ADMIN_API_KEY`
  (the signing-up human never sees it - `SaaS-A0`'s own note anticipated
  exactly this), encrypts the returned key, hashes the password, creates
  the account, and logs the new user straight in. Reuses
  `lib/login-rate-limit.ts`'s bucket machinery under a `signup:` key
  prefix rather than a second limiter. The early
  `SELECT ... WHERE email = ?` existence check is a fast-path, not the
  correctness guarantee - a concurrent signup could still race across
  the `await` to the license server, so the actual `INSERT` is also
  wrapped to catch the unique-index violation. If the tenant was already
  provisioned when that happens, it's now orphaned on
  `casazium/license` - logged clearly for manual cleanup via that repo's
  own revoke endpoint rather than auto-revoked (a network call in an
  already-failing path has its own failure modes).
- **`lib/auth.ts`** — branches on `isMultiTenant()` as described above.
- **`app/signup/`** — page + form, mirroring `app/login/`'s structure
  and Mantine patterns closely. The page itself also 404s under
  self-hosted (`notFound()`), not just the API route, so a stale link
  can't render a form that always fails on submit.
- **`app/login/page.tsx`** — conditionally shows a "Sign up" link only
  under `MULTI_TENANT=true`.
- **`proxy.ts`** — `/signup`/`/api/signup` added to `PUBLIC_PATHS`
  unconditionally (both routes self-gate instead), matching this file's
  role of session-checking, not feature-flagging.
- **`.env.example`**, **`README.md`** — `MULTI_TENANT`,
  `ACCOUNT_ENCRYPTION_KEY` documented; `ADMIN_UI_USERNAME`/`PASSWORD`'s
  existing comment updated to note it's self-hosted-only now;
  `LICENSE_ADMIN_API_KEY`'s comment updated to note its new signup-time
  dual-use.

### Verified

`npm run lint` clean; `npm run build` compiles, passes TypeScript, all
11 routes generated (`/signup`, `/api/signup` included) with no tracing
warnings. Then a real integration test, not mocked: booted an actual
`casazium/license` server instance (`MULTI_TENANT=true`, a freshly
generated RSA keypair and encryption key, real SQLite file) alongside
the console's real `.next/standalone/server.js`, both processes, real
HTTP between them:

- Signup created a real row in both databases - `accounts.tenant_id`
  in this console's DB matches the `tenants.id` `casazium/license`
  actually provisioned.
- A second signup with the same email correctly rejected (409, generic
  message - doesn't confirm the email is taken).
- Decrypted `accounts.tenant_api_key_encrypted` back out and used it as
  a bare `Authorization: Bearer` against `casazium/license`'s real
  `POST /issue-license` - it worked, issuing an actual license as that
  tenant. Proves the encrypt/decrypt round-trip end-to-end, not just
  that it doesn't throw.
- Login with the signup credentials succeeded; wrong password rejected
  with the same generic error.
- Restarted the console with `MULTI_TENANT` unset (self-hosted):
  `/signup` and `/api/signup` both 404, the static
  `ADMIN_UI_USERNAME`/`PASSWORD` pair still logs in, and the login page
  shows no signup link - confirms the byte-identical claim, not just
  asserts it.

### Explicitly not in this task's scope

- Password-reset - blocked on an email-provider decision, deferred by
  operator choice rather than picked unprompted.
- Team invites (multiple accounts per tenant) - schema-compatible, not
  built.
- Threading the account's `tenant_id`/decrypted key into actual
  license-management API calls - that's `SaaS-B2`'s job, a real
  refactor of `license-client.ts`'s dispatcher functions, not something
  this task's narrower signup/login scope should reach into.

## 32. SaaS-B1c: session model + revocation (2026-08-05)

Resolves the fork `SaaS-B1a`'s own `schema.sql` comment left open: a
sessions table, or a JWT-blocklist watermark. Decision: watermark - both
of this task's actual triggers (password reset, a tenant revoked on
`casazium/license`) only ever need to invalidate *every* session for an
account at once, never one specific device, so a per-session table would
buy nothing here. Full rationale in `casazium/license/PROJECT_STATUS.md`
§37.

### What was built

- **`lib/db/schema.sql`** — `accounts.sessions_revoked_at DATETIME`
  (nullable), added directly into the existing `CREATE TABLE`, not a
  defensive `ALTER` - this table is new on an unmerged branch with no
  real deployment to migrate (§5's disposability rule).
- **`lib/session.ts`** — `Identity` gains an optional `tenantId`, *not*
  embedded in the signed JWT payload at issuance. Re-derived fresh from
  `accounts.tenant_id` on every `verifySessionToken()` call instead,
  under `MULTI_TENANT` only - the DB is the single source of truth, and
  the lookup is already required per request to check revocation, so
  this doesn't cost an extra query. `revokeAccountSessions(accountId)`
  sets the watermark; not wired to any caller yet since password-reset
  (the trigger that would call it) is still deferred (`SaaS-B1b`) - it
  exists and is tested so that flow's eventual implementation is a small
  addition, not new plumbing.

### A real bug found by testing, not assumed away

Both the JWT `iat` claim (per spec, `NumericDate` - whole seconds) and
SQLite's `CURRENT_TIMESTAMP` are second-granularity. The first
comparison written (`revokedAtSeconds >= payload.iat`) rejects a
same-second re-login after revocation - confirmed empirically (not
hypothetical) while verifying this task: log in, revoke, log in again
immediately, and the fresh session was itself treated as already
revoked, since the fast automated test's revoke-then-relogin landed in
the same wall-clock second. Fixed to strict `<` (only tokens issued
*before* the revoked second are rejected), accepting a narrower,
inherent trade-off instead: a token issued a fraction of a second
*before* the revocation, in that same second, survives one extra second
past it. Re-verified with a deliberate 2-second gap between login and
revoke to get an unambiguous signal (the first, unpaced version of this
test wasn't actually distinguishing the two cases it claimed to).

### Verified

`npm run lint` clean; `npm run build` compiles, passes TypeScript, no
warnings - notably including whether `lib/session.ts`'s new
`better-sqlite3` import (via `lib/db.ts`) even works inside `proxy.ts`'s
middleware/proxy runtime at all, a real open question going in (Next.js
middleware has historically run in a restricted Edge runtime that
doesn't support native addons) - resolved empirically, not assumed: a
real `.next/standalone/server.js` run, through the actual middleware,
correctly let an active session through and correctly redirected a
revoked one to `/login`, proving the DB call inside the proxy genuinely
executes. Full sequence tested: login grants access; revoke (after a
deliberate 2s gap) rejects the pre-existing cookie with a 307 to
`/login`; an immediate fresh re-login in the same second as the
revocation works right away, not delayed a full second.

Not independently re-verified beyond code review: `Identity.tenantId`
actually being populated correctly end-to-end (no route yet surfaces it
to check against) - the query that populates it is the identical query
already proven correct for the revocation check above, so this is a low
residual risk, not zero.

## 33. SaaS-B1d: deferred, not built (2026-08-05)

Full rationale in `casazium/license/PROJECT_STATUS.md` §39. Short
version: `B1d`'s own justification (*"SaaS hosting is the deployment
shape [`lib/login-rate-limit.ts`] doesn't support (needs a shared
store)"*) directly contradicts `SaaS-B1a`'s own decision (§30) that
single-replica is this console's actual target topology, made from the
same evidence - today's `docker-compose-coolify.yml` sets no replica
count, and `SaaS-C1` (the only task that could actually decide otherwise)
hasn't run. `lib/login-rate-limit.ts`'s own header comment already says
its in-memory design is *"adequate for a single-replica deployment"* -
by B1a's own reasoning, that's still true today.

Building distributed (Redis-backed) rate limiting now would mean
picking new infrastructure unprompted for a requirement that isn't
confirmed, and would silently reverse B1a's decision without revisiting
it - B1a was explicit that "if `SaaS-C1` ever needs horizontal scaling
... that reopens this question," not "B1d gets to reopen it on B1a's
behalf." Operator confirmed: defer. `lib/login-rate-limit.ts` is
untouched. Revisit together with B1a's own SQLite choice if/when
`SaaS-C1` actually decides multi-replica hosting - not before, and not
one without the other.

## 34. SaaS-B2: thread tenant context through license-client (2026-08-05)

Grounded before writing code (per F8, §5): the real call graph is small
- only 4 places actually call the 13 dispatcher functions (3 read pages
plus `app/(app)/licenses/actions.ts`, which already called
`requireSessionForAction()` at the top of every mutation, discarding its
return value). Every one of the 13 functions also funnels through a
single `liveFetch` choke point. Given that shape, explicit parameter
threading was the clear choice over `AsyncLocalStorage` - small,
auditable, and (see below) it fixes F8's cache-poisoning flag as a side
effect rather than needing separate handling.

### What was built

- **`lib/session.ts`** — `requireSessionForAction` renamed to
  `requireSession`; same check, now also called from read pages (gated
  by `proxy.ts` already, but pages still need the identity to resolve
  tenant context).
- **`lib/tenant-context.ts`** (new) — `getTenantApiKey(accountId)`
  decrypts `accounts.tenant_api_key_encrypted` on demand.
  `requireSessionWithTenantKey()` is the actual call-site helper (all 8
  real call sites - 5 actions, 3 pages - use it, not 8 hand-copied
  inline pairs): resolves the session, then the tenant key only if
  `identity.tenantId` is set. Factored out deliberately - F8's own
  warning was that *one missed call site* silently operates as the
  cross-tenant superuser, and a shared helper is what makes that
  auditable in one place instead of trusting 8 sites to stay consistent.
- **`lib/license-client.live.ts`** — every exported function gains a
  trailing `tenantApiKey?: string`. `resolveApiKey()` replaces the old
  bare `adminKey()`: under `MULTI_TENANT`, a missing key is a **hard
  error**, never a silent fallback to `LICENSE_ADMIN_API_KEY` - the
  literal fail-closed rule F8 asked for ("delete the old global-env
  fallback rather than leaving it as a silent cross-tenant-superuser
  escape hatch"). Self-hosted callers never pass the parameter, so
  `resolveApiKey()` falls through to today's exact env-var read,
  unchanged.
- **`getBroadActiveLicenses`'s `cache()` wrapper** now takes
  `tenantApiKey` as an argument - this is the fix for F8's other flagged
  risk ("no cache-key args... a cross-tenant cache-poisoning risk once
  per-tenant"), and falls out naturally from the parameter-threading
  design rather than needing a separate change: React's `cache()` keys
  by argument value, so a plain string argument partitions the
  memoization per tenant without reintroducing the referential-equality
  bug the original no-args design was written to avoid.
- **`lib/license-client.mock.ts`** — all 13 functions gain the same
  trailing parameter for type parity with the live client (`license-client.ts`'s
  dispatcher types every export as `typeof mock.xxx`), unused in mock
  mode's own body - mock mode has no real tenant concept, and
  `MULTI_TENANT=true` + mock/standalone mode isn't a reachable
  combination in practice (signup requires a real `LICENSE_API_URL`/`LICENSE_ADMIN_API_KEY`
  backend to provision tenants against).
- **`license-client.ts`** — every dispatcher export forwards the new
  parameter straight through.
- **4 call sites updated**: `app/(app)/dashboard/page.tsx`,
  `app/(app)/licenses/page.tsx`, `app/(app)/licenses/[key]/page.tsx`, and
  `app/(app)/licenses/actions.ts`'s 5 actions - all now call
  `requireSessionWithTenantKey()` and thread the result through.

### Verified

`npm run lint` clean; `npm run build` compiles, passes TypeScript, all
11 routes generated, no warnings. Then the test that actually matters
for what this task exists to guarantee - not just a clean build, a real
cross-tenant isolation check: booted a real `casazium/license` instance
(`MULTI_TENANT=true`) and this console's real standalone server, signed
up **two separate tenants** (Acme Corp, Widget Inc), issued a distinct
real license under each directly against the backend using each
tenant's own decrypted key, then hit the console's real `/licenses` and
`/dashboard` pages as each tenant:

- Acme's `/licenses` page showed only its own license
  (`acme-customer@example.com` / `widget-pro`) - no trace of Widget's.
- Widget's `/licenses` page showed only its own
  (`widget-customer@example.com` / `gadget-basic`) - no trace of Acme's.

Also verified self-hosted mode is unaffected, but caught a test-setup
mistake along the way worth recording: pairing a self-hosted console
against the *same* `MULTI_TENANT=true` server instance used for the
isolation test produced a 500, not a working page - not a B2 bug, but
`casazium/license`'s own pre-existing, already-established rule
(`SaaS-A0`/`A3`) that the admin key is never valid on the 10
tenant-scoped routes once `MULTI_TENANT=true`. Self-hosted console only
pairs with a self-hosted server, never with the same server backing a
SaaS deployment - re-ran against a genuine self-hosted (`MULTI_TENANT`
unset) server instance instead, which worked correctly (200, the
expected license visible).

Not independently re-verified: an actual Server Action invocation
through the browser/form (Next's Server Action wire protocol isn't
something plain `curl` can replicate) - `actions.ts` calls the
identical `requireSessionWithTenantKey()` helper and identical
dispatcher functions already proven correct on the read side, so this
is a low residual risk, not zero.

## 35. SaaS-B3: branding moves to DB-driven per tenant (2026-08-05)

Grounded before writing code: `getBranding()` is called from 4 places,
and one of them - the root layout (`app/layout.tsx`) - wraps *both*
pre-auth pages (`/login`, `/signup`, no session by definition) and the
authenticated app. There's no signal available pre-auth (no subdomain
routing, no tenant-identifying URL) to know which tenant's branding to
show before login succeeds - genuinely unreachable information at that
point, not something this task's own scope (branding's *resolution*
mechanism) should try to solve by redesigning login. Resolved by
splitting branding into two tiers: platform default (env vars - shown
pre-auth, and to self-hosted always) and tenant override (DB - shown
only once a session with a `tenantId` exists).

### What was built

- **`lib/db/schema.sql`** — `tenant_branding`, one row per tenant, every
  column independently nullable. Field-level fallback, not
  row-absent-or-not: a tenant can override just `color` without also
  needing a logo - verified directly (see below), not just designed
  that way.
- **`lib/session.ts`** — new `getSession()`, a non-throwing peek,
  alongside the existing `requireSession()` (which still throws) - the
  root layout is the one place that legitimately doesn't know in
  advance whether a session exists; `requireSession()` refactored to
  call it internally rather than duplicating the cookie-read logic.
- **`lib/branding.ts`** — `getBranding(tenantId?)`. No `tenantId`, or
  `MULTI_TENANT` off: today's exact env-var behavior, unchanged. With a
  `tenantId`: looks up `tenant_branding`, falling back per-field to the
  platform default for anything unset. The env-only quoting workaround
  (`unwrapQuotes`, for dotenv/platform-UI quirks) deliberately isn't
  applied to DB-stored values - a settings form (once one exists) has no
  such quoting pipeline to work around.
- **`app/layout.tsx`** (root) — now `async`, calls `getSession()` and
  passes `session?.tenantId` through to both `generateMetadata()`
  (favicon) and the page body (`--brand-color`).
- **`app/(app)/layout.tsx`** — calls `requireSession()` (not
  `getSession()`) - every route under this layout is already gated by
  `proxy.ts`, so a session is always expected; fail loud if that's ever
  untrue instead of silently rendering platform branding on what should
  be a tenant's own page.
- **No settings UI** writes `tenant_branding` — no task in the current
  plan owns building one (not `B4`, not `B5`). Out of this task's scope,
  flagged explicitly rather than silently built or silently skipped.
  Verified instead the same way `SaaS-B1c`'s revocation mechanism was:
  direct DB writes, proving the read-side mechanism end-to-end.

### Verified

`npm run lint` clean; `npm run build` compiles, passes TypeScript.
Noted, not a bug: `/` went from statically prerendered to
server-rendered-on-demand in the build output, since the root layout now
reads cookies on every request - the correct, expected consequence of
branding genuinely depending on request-specific session state.

Real end-to-end test against a live `casazium/license` instance and this
console's real standalone server, `MULTI_TENANT=true`:

- Pre-auth `/login` showed the platform (env-var) title, confirmed
  before any tenant existed.
- Signed up a tenant; its dashboard fell back to platform branding with
  no `tenant_branding` row yet.
- Inserted a row for that tenant (custom title + color) directly;
  reloaded - dashboard now showed the tenant's own title and
  `--brand-color`. `/login` was re-checked immediately after and still
  showed the platform title, unaffected.
- Signed up a second tenant, inserted a *partial* row (color only, no
  title) - its dashboard showed the custom color combined with the
  *platform* title, confirming field-level (not row-level) fallback.
- Restarted with `MULTI_TENANT` unset against a genuinely self-hosted
  server instance: `/login` and the post-login dashboard both showed the
  env-var branding, exactly as before this task - self-hosted is
  unaffected.

