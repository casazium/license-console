# PROJECT_STATUS.md — license-console

Status: Draft
Last updated: 2026-07-31 (login/branding design review round 3: hydration warning fix, favicon, CORS clarification)

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

Known non-blocking item: `app/(app)/licenses/page.tsx`'s "Issue license"
button uses Next's deprecated `legacyBehavior`/`passHref` Link pattern
(needed to render `Button` as a real `<a>` without nesting two interactive
elements, from a Server Component). Works, prints a console deprecation
warning. Worth a cleanup pass later; not urgent.

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
  authorized or built**, tracked here so it isn't lost.
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

## 10. Next authorized step

Implement a real license-server API client (server-side only, using
`LICENSE_API_URL` / `LICENSE_ADMIN_API_KEY`) and swap it in behind the same
`lib/license-client.ts` function signatures the mock already uses, so no
page needs to change - starting with `listLicenses`/`issueLicense` since
those are the simplest end-to-end slice.

Note: per §9 above, the login page's username + branding items are now
built and verified. Continuing the page-by-page UI review (next: the
dashboard page) is the operator's likely next step; this API-client step
follows once the review is complete, unless re-prioritized.
