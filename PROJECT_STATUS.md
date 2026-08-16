# PROJECT_STATUS.md — license-console

Status: Draft
Last updated: 2026-08-16 (§65: pre-launch gap analysis finding #1 -
the console side of the new license-update route (see casazium/license's
own PROJECT_STATUS.md §131 for the backend route and the SQL-injection
finding an independent design review caught before this was built). New
"Edit terms" button on the license detail page, opening a modal to
change expires_at (with a "Perpetual" checkbox), max_activations (with
an "Unlimited seats" checkbox), and limits (reusing the exact Fieldset
already built for the Issue License form). Always resends the full
current form state on Save rather than computing a client-side partial
diff - simpler and less surprising.

Extracted the limits-editing form model (NUMERIC_LIMIT_FIELDS,
buildLimits, INITIAL_LIMITS) and its Fieldset UI out of IssueLicenseForm.tsx
into lib/limits-form.ts and components/LimitsFieldset.tsx respectively,
now shared by both the issue form and the new edit-terms modal - one
place to update if casazium/license's own ALLOWED_LIMIT_KEYS allow-list
ever changes, not two.

Fixed 4 pre-existing type/rendering gaps surfaced while building this
(not all originally scoped, but load-bearing for this feature to work
correctly):
- License.expires_at was typed non-nullable (string) despite the
  backend having supported null/perpetual for a while; License had no
  limits field at all and a dead usage_limit/usage_count pair that
  never matched what the live backend actually returns (only
  license-client.mock.ts ever populated them) - the live detail page
  rendered "undefined / undefined" for every real license's Usage line
  until this fix, confirmed via a real browser test before and after.
- lib/format.ts's formatDate/formatDateTime both used to construct
  `new Date(iso)` unconditionally - new Date(null) is the Unix epoch,
  not "never" - so a perpetual license's expiry silently rendered as
  1970-01-01. Both now null-tolerant, rendering "Never".
- max_activations is nullable too (null = unlimited seats, a state the
  edit-terms route can now reach) - License.max_activations widened,
  and both the detail page's and LicensesTable.tsx's seat badges now
  render "Unlimited" instead of doing arithmetic against null.
- A live browser test caught a second bug the design review didn't:
  setting "Unlimited seats" and saving showed "0 / 0" instead of
  "0 / Unlimited" on reload - traced to casazium/license's own
  admin-license.js response schema still declaring max_activations as
  plain `type: 'integer'`, silently coercing a real null DB value to 0
  on the way out (fixed there, see that repo's own PROJECT_STATUS.md).

New updateLicenseTerms client function (live + mock, dispatcher-typed
per the existing convention) and updateLicenseTermsAction Server Action,
following the established ActionResult<T> + requireSessionWithTenantKey()
+ markIfTenantRejected() shape. Revalidates the detail page, the list
page (Expires/Seats columns), and the dashboard (expiring-soon and
near-seat-limit widgets all derive from these same fields).

Verified live end to end against a real running casazium/license
backend (not mocked): confirmed the Usage line and seat badge no longer
show the undefined/epoch/0-vs-unlimited bugs before touching anything;
opened the modal and confirmed it prefills from the license's real
current expires_at/max_activations/limits; saved with both "Perpetual"
and "Unlimited seats" checked and confirmed "Expires at: Never" and
"Seats: 0 / Unlimited" render correctly; re-opened and edited back to a
real expiry and a changed limit value and confirmed both round-trip
correctly. lint/tsc/build all clean.)
2026-08-15 (§64: pre-launch gap analysis finding #6 -
the "Issue License" form now exposes casazium/license's own `limits`
object, which the backend has always accepted but this console never
surfaced - an operator previously had no way to set a seat count, an
API-calls-per-day cap, or any other usage limit except by calling
POST /issue-license directly. New "Limits (optional)" fieldset: 9
NumberInputs mirroring that repo's own ALLOWED_LIMIT_KEYS numeric
subset exactly (users, seats, admins, projects, environments, tenants,
api_calls_per_day, rate_limit_rps, concurrent_sessions), plus a
TagsInput for `features` - the one array-of-strings exception on that
same allow-list. A blank field is genuinely omitted from the submitted
limits object (not sent as 0), matching validateLicenseLimits.js's own
semantics: an absent key means "not enforced," not "limit is zero."
IssueLicenseInput/LicenseLimits types added; license-client.live.ts's
issueLicense already forwarded the whole input object verbatim, so no
client-layer change was needed there. lint/tsc/build all clean.
Verified live end to end (real browser, real console dev server, real
casazium/license backend, not mocked): submitted seats=25,
api_calls_per_day=5000, concurrent_sessions=10, features=[sso,
advanced-reporting] with the rest left blank, then fetched the license
back via GET /admin/license/:key and confirmed the stored limits
object contained exactly those 4 keys with no zero-filled extras;
separately confirmed the common no-limits-set path still issues
cleanly and stores limits: {}.)
2026-08-15 (§63: pre-launch gap analysis finding #4 -
added a "Customer" search box to the Licenses page, alongside the
existing Status/Product filters (same URL-param-driven pattern as the
existing product_id TextInput in LicensesFilters.tsx). Threads issued_to
through ListLicensesParams -> license-client.live.ts's
fetchRawLicenses (as a new query param) and license-client.mock.ts (a
case-insensitive substring filter matching the real backend's own new
LIKE-based match - see casazium/license's own PROJECT_STATUS.md §130
for the server-side half of this fix). npm run lint and tsc --noEmit
both clean; npm run build succeeds. Verified live in a real browser
(Playwright against the pre-installed Chromium, self-hosted admin
login, mock backend data): the search box renders, a non-matching
search correctly shows the existing "No licenses match these filters"
empty state, a substring search matches the expected rows, and an
ALL-CAPS search still matches - confirming case-insensitivity survives
the full path through the UI, not just the backend route in isolation.)
2026-08-15 (§62: added a 'restored' outcome branch to
SelfLicenseIndicator, matching casazium/license's own §126 fix - a
redeploy landing inside the backend's 14-day credential validity
window previously showed the same "pending first check-in" badge as a
genuinely fresh Tier-B build that had never checked in, even though
the mechanism was actually healthy. New blue badge: "using cached
credential", honestly labeled with the boot's own confirmation time,
not a fabricated expiry. npm run lint/build both clean.)
2026-08-15 (§61: new SelfLicenseIndicator on the
post-login dashboard - a beta-testing visibility badge for whether
casazium/license's Tier-B self-license call-home is actually
succeeding, consuming that repo's new GET /v1/self-license/status
(its own PROJECT_STATUS.md §125). Renders nothing for the common
tier-a case, deliberately placed post-login not on the login page.
Verified live: a real console dev instance, pointed at a real
casazium/license backend, correctly fetched and rendered the tier-a
case end to end - confirmed via the backend's own request logs
showing two real 200s for GET /v1/self-license/status, not assumed.
npm run build and npm run lint both clean.)
2026-08-15 (§60: docker-compose-coolify.yml audited
against every real process.env read in the codebase - no gap found,
unlike casazium/license's own compose file the same day (that repo's
PROJECT_STATUS.md §122). A real self-hosted console resource was then
configured end to end against casazium/license's new SLS/Tier-B
backend and a real ADMIN_API_KEY/LICENSE_ADMIN_API_KEY mismatch was
diagnosed and fixed live)
2026-08-12 (restore drill added - the backup pipeline had
never actually been used to restore anything; see §59. §58 closed the
off-box push gap - real B2 pushes confirmed, plus a standalone/SaaS
commingling bug, a missing remote-retention gap, and a local
sidecar-pruning bug all found and fixed along the way)

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

## 36. SaaS-B4: billing UI + explicit over-quota error mapping (2026-08-05)

Grounded before writing code: this task needs the console to call
`casazium/license`'s billing provider on a tenant's own behalf, but that
server exposed exactly one billing route (`POST /billing-webhook`,
admin-key-only). Confirmed with the operator before proceeding rather
than assuming either way - this task ended up spanning both repos:
`GET /billing/status` and `POST /billing/checkout` were added there
first (that repo's own `PROJECT_STATUS.md` §45), tenant-scoped like the
9 other admin routes, not admin-key-gated.

### What was built here

- **`lib/license-types.ts`** — `BillingStatus`, mirroring
  `casazium/license`'s `BillingProvider.getSubscriptionStatus` shape
  exactly.
- **`lib/license-client.{live,mock,ts}`** — `getBillingStatus`,
  `createCheckoutSession`, following the exact same
  live/mock-dispatch + trailing-`tenantApiKey` pattern `SaaS-B2`
  established for every other function - even though billing is only
  ever meaningful under `MULTI_TENANT`, routing it through the same
  dispatcher (rather than a live-only bypass) keeps standalone/demo mode
  able to show the billing page's look and feel too, matching that
  mode's own purpose. Mock returns a fixed "active, pro plan" demo
  value.
- **`lib/errors.ts`** — `isOverQuota()`/`isPaymentFailed()`, matching
  `casazium/license`'s `quota.js`'s exact two error strings.
  `license-client.live.ts`'s `issueLicense()` now surfaces the server's
  own `error` text for `403`s specifically (every other function still
  throws the generic "Failed to X: status statusText" - only
  `POST /issue-license` can produce this specific pair of messages).
- **`app/(app)/licenses/actions.ts`** — `ActionResult`'s failure case
  widened from a single `rateLimited: true` flag to
  `reason: 'rate-limited' | 'over-quota' | 'payment-failed'`, shared
  across all 5 actions for a consistent shape even though only
  `issueLicenseAction` can actually produce the new two reasons.
- **`app/(app)/billing/`** — new route: `page.tsx` (404s under
  self-hosted, same posture as `/signup`), `PlanSelector.tsx` (client
  component, `POST`s to a new `actions.ts`'s `createCheckoutSessionAction`,
  then a real browser navigation via `window.location.assign()` to the
  returned URL - not `next/navigation`'s router, which is only for this
  app's own internal routes). The two plans offered (`free`/`pro`)
  mirror `casazium/license`'s own `quota.js` `PLAN_LIMITS` exactly -
  placeholder numbers, not this task's to invent real pricing for.
- **`app/(app)/AppShellClient.tsx`** — a "Billing" nav item, shown only
  when `app/(app)/layout.tsx`'s already-resolved `session.tenantId` is
  set (doubles as the `MULTI_TENANT` check without a second import).
- **`app/(app)/licenses/new/page.tsx`** — the one place that calls
  `issueLicenseAction`, now branches on `result.reason` to show the
  right one of three distinct notifications (`lib/notify.ts`'s new
  `notifyOverQuota()`/`notifyPaymentFailed()`, alongside the existing
  `notifyRateLimited()`) instead of always assuming rate-limited.

### Verified

`npm run lint` clean; `npm run build` compiles, passes TypeScript, all
13 routes generated including `/billing`, no warnings (one lint error
along the way, not silently worked around: this project's `react-hooks`
config rejects direct `window.location.href =` mutation from an event
handler - fixed to `window.location.assign()`, which the linter
accepts, not a suppression).

Server-side: `casazium/license`'s new routes got their own dedicated
test file there (5 tests, cross-tenant isolation + the admin-key
boundary), not re-tested here.

Given this task introduces genuinely new client-side interactive logic
(a click-to-redirect flow, and three-way error-notification branching)
that a plain `curl`-based Server Action call can't exercise - unlike
`SaaS-B2`'s write path, which only threaded already-proven plumbing -
this was verified with a real headless browser (Chromium, pre-installed
in this environment) driving the actual running app, not just HTTP
assertions:

- Signed up a real tenant; `/billing` correctly showed the default
  "Free (default)" / active state before any real subscription existed.
- Clicked "Select" on the Pro plan; the browser genuinely attempted to
  navigate to the stub checkout URL (landed on Chrome's own DNS-error
  page for the deliberately-fake `stub-billing.invalid` domain, which
  is exactly the expected outcome, not a bug).
- Seeded 5 licenses directly against the real backend to hit the
  free-tier limit, then submitted the real "Issue license" form through
  the browser for a 6th: the "License quota reached" / "Upgrade your
  plan" notification appeared, and the form correctly did *not* navigate
  away as it would on success.
- Sent a real `payment_failed` webhook event to the real backend, then
  reloaded `/billing` (showed "past due" and the inactive warning) and
  resubmitted the issue-license form: the "Subscription inactive"
  notification appeared.

## 37. SaaS-D3: console-side half closed out (2026-08-05)

`SaaS-D3`'s revised scope (`casazium/license`'s `PROJECT_STATUS.md` §4,
F15) is "quota enforcement test, plus verification of `B4`'s
console-side over-quota error mapping, not just the server-side 403."
The server-side half was done first and left explicitly partial (§31 in
that repo), console-side blocked on `SaaS-B4` not existing yet.

`SaaS-B4`'s own verification (§36 above) already did real browser
testing of the core ask - both blocked states (over-quota,
payment-failed) correctly show their distinct notification through the
actual console UI. What that testing didn't cover, and what this pass
adds: **recovery through the console UI**, not just via direct API
calls (which is all `SaaS-D3`'s original server-side pass, §31 in that
repo, tested). A blocked state that clears server-side but stays stuck
client-side (stale session data, a cached decision, whatever the actual
cause might be) is exactly the kind of gap a server-only test can't
catch.

### Verified

Same real two-server, real-browser setup as `B4`'s own test:

- Hit the free-tier quota (5 licenses), confirmed the 6th shows the
  over-quota notification through the real form - re-confirming `B4`'s
  own result, not assumed still true.
- Sent a real `subscription_updated` webhook upgrading the tenant to
  `pro`: `/billing` correctly showed the new plan, and a subsequent
  issue-license submission through the real form **succeeded** -
  redirected to the new license's own detail page, not stuck showing a
  stale quota notification.
- Sent `payment_failed`, confirmed the form shows "Subscription
  inactive"; sent `subscription_updated` again, confirmed a further
  submission succeeded - the same recovery proof for the other trigger.

`SaaS-D3` is now fully closed - both server-side (that repo's
`PROJECT_STATUS.md` §31) and console-side (this section) are verified,
not partial.

## 38. SaaS-B5: signup to first-license onboarding flow (2026-08-05)

Grounded before writing code: every successful signup (`SaaS-B1b`)
provisions a brand new, license-less tenant - there is no existing-
tenant case to distinguish, so signup can always redirect to onboarding
unconditionally, with no new "has this tenant already onboarded" flag
needed. The license detail page already shows a "how to activate this
license" snippet (built well before this task), so onboarding's natural
completion is just: issue the first license, land on that existing page
- not a second, parallel completion screen invented for this task.
Entirely console-side; `casazium/license` has no stake in this one.

### What was built

- **`lib/db/schema.sql`** — `accounts.tenant_name`, the "Company /
  organization" value the signup form already collected and previously
  discarded. Added directly to the `CREATE TABLE` (this table is still
  new on an unmerged branch, §5), not a defensive `ALTER`.
- **`app/api/signup/route.ts`** — persists it.
- **`lib/tenant-context.ts`** — `getTenantName(accountId)`, for
  onboarding's welcome copy. Not fetched from `casazium/license`
  instead - that server's `tenants.name` isn't exposed by any
  tenant-scoped route, and adding one just for this wasn't worth it
  when the value was already sitting unused in this console's own DB.
- **`app/(app)/licenses/IssueLicenseForm.tsx`** (new, extracted from
  the former `licenses/new/page.tsx`) — identical fields/validation/
  submit handling, now shared by both `/licenses/new` and
  `/onboarding`, parameterized by `heading`, `submitLabel`, and an
  optional `skipHref`.
- **`app/(app)/onboarding/page.tsx`** (new) — 404s under self-hosted,
  same posture as `/signup`/`/billing`. Welcome copy using the tenant's
  name, then the shared form, then a "Skip for now" link to `/dashboard`.
- **`app/signup/SignupForm.tsx`** — redirects to `/onboarding` instead
  of the (empty, for a new tenant) `/dashboard`.

### A real bug caught during verification, not shipped

Passing `<Anchor component={Link}>` (a pre-rendered element holding a
raw `next/link` component reference) as a prop from the onboarding page
(a Server Component) into `IssueLicenseForm` (a Client Component)
crashed the page outright in the real standalone build - "Functions
cannot be passed directly to Client Components," a genuine React Server
Components serialization boundary, not something `npm run build`'s
static analysis alone caught. Fixed by having `IssueLicenseForm` accept
a plain `skipHref` string and render its own `<Anchor component={Link}>`
internally, entirely within the already-client component - `Link` is
never passed across the boundary at all now.

### Verified

`npm run lint` clean; `npm run build` compiles, passes TypeScript, all
14 routes generated including `/onboarding`, no warnings.

Real browser end-to-end (the RSC crash above was only found this way -
`npm run build` alone reported success): signed up a real tenant,
confirmed the redirect landed on `/onboarding` (not `/dashboard`) and
the welcome copy showed the real company name; submitted the onboarding
form and confirmed it issued a real license, landing on that license's
own detail page with the activation snippet and the correct
`issued_to` visible; separately confirmed the regular `/licenses/new`
page still works correctly post-extraction (its own heading, no stray
"Skip for now" link, a real submission redirects correctly - checked
via a script that doesn't repeat this repo's own previously-documented
`waitForURL('**/licenses/*')` false-positive pitfall, since the
starting URL there already matches that glob before any real navigation
happens). Restarted self-hosted (`MULTI_TENANT` unset) against a
genuinely self-hosted server: `/onboarding` 404s, `/licenses/new` still
renders and works correctly - the shared-component extraction didn't
regress self-hosted.

## 39. SaaS-C1: Coolify deployment documentation (2026-08-05)

`SaaS-C1` is real infrastructure provisioning against an actual Coolify
account - no credentials/API access for that exist in this session, and
even with them, creating billed cloud resources isn't something to do
unilaterally. Operator confirmed: prepare the documentation and fix
whatever's needed to make the eventual manual provisioning correct.
Full decision/framing record is `casazium/license/PROJECT_STATUS.md`
§50; this section is the build record for this repo specifically.

### A real bug found before documenting around it

`docker-compose-coolify.yml` was missing both `MULTI_TENANT` and
`ACCOUNT_ENCRYPTION_KEY` from its `environment:` block entirely -
Coolify's env-var UI only populates `${VAR}` interpolation in the
compose file itself, so an operator setting these in Coolify's UI as
instructed by any deployment guide would have them silently never reach
the container. Both added
(`MULTI_TENANT=${MULTI_TENANT}`, `ACCOUNT_ENCRYPTION_KEY=${ACCOUNT_ENCRYPTION_KEY}`),
validated with `docker compose config` (exit 0).

### What was written

- **`DEPLOYMENT.md`** (new - this repo had none before this task,
  unlike `casazium/license`, which already had one to extend). Leads
  with "Which mode do I want?" before any setup steps, since self-hosted
  and SaaS mode are genuinely separate deployments here, not one setup
  with an optional flag - explains directly why pairing a self-hosted
  console with a SaaS-mode server (or the reverse) doesn't work
  (`casazium/license`'s own `SaaS-A0` admin-key boundary), a mismatch
  `SaaS-B2`'s own testing already produced and diagnosed once. Covers
  self-hosted first (steps 1-5, mirroring `casazium/license`'s own
  `DEPLOYMENT.md` structure), then the SaaS-tier addendum: deploy that
  server's own SaaS instance first, the two new env vars, and a
  correction to persistent-storage guidance specific to this
  console - self-hosted mode never actually touches this console's own
  SQLite database in normal operation (every real call site is gated
  behind `MULTI_TENANT` except the `SaaS-B1a` `/api/health/db`
  verification route, which isn't linked from anywhere and isn't
  Coolify's own healthcheck target - confirmed by checking every
  `getDb()` call site directly, not assumed), so the volume only starts
  mattering once SaaS mode is on.
- **`README.md`** — added a pointer to `DEPLOYMENT.md`; there wasn't
  one before.

## 40. SaaS-C4: no console-side change (2026-08-05)

`SaaS-C4` ("secrets management for Stripe keys only") is entirely
server-side - `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` are read and
validated only by `casazium/license`'s own `src/lib/config.js`. This
console never holds Stripe secrets in any config, mode, or env var; its
own `ACCOUNT_ENCRYPTION_KEY` (`SaaS-C1`, §39) is unrelated - it encrypts
tenant API keys for the license server, not billing credentials. No file
in this repo changed for this task. Full build record, including a
scope-creep risk found and corrected before implementing anything, is
`casazium/license/PROJECT_STATUS.md` §52.

## 41. Signup confirmation email, EmailProvider stub (2026-08-05)

Prompted by a production-readiness review the operator asked for
directly - password-reset (`SaaS-B1b`, §31) was already on record as
"blocked on an email-provider decision, deliberately deferred rather
than guessed at." Operator chose to start with signup confirmation
specifically, and to build the interface now against a stub sender
rather than wait on real provider credentials - mirrors exactly how
`casazium/license`'s own `BillingProvider`/stub-provider pattern
(`SaaS-A5`) let checkout/webhook logic get built and tested before any
real Stripe keys existed.

### What was built

- **`lib/email/provider.ts`** - `EmailProvider` interface,
  `sendSignupConfirmation(to, confirmUrl)` only for now (a
  `sendPasswordReset` method would be the natural next addition when
  that task is authorized).
- **`lib/email/stub-provider.ts`** - logs the confirmation link
  server-side instead of sending. **`lib/email/index.ts`** - selection
  by `EMAIL_PROVIDER` env var (default `stub`), mirroring
  `BILLING_PROVIDER`'s own posture exactly: any other value is accepted
  as a recognized config value but fails loudly at the point of use, not
  silently falls back.
- **`lib/db/schema.sql`** - `accounts.email_verified_at` (nullable
  watermark, same shape as `sessions_revoked_at`) and a new
  `email_verification_tokens` table. Unlike `accounts.tenant_id`
  (`casazium/license`'s own database), `account_id` here is a real
  foreign key with `ON DELETE CASCADE` - both rows live in this same
  database, so the guarantee can be enforced at the DB level rather than
  left to app-level discipline (mirrors `casazium/license`'s own A1
  reasoning for its `activations` FK). Only the token's hash is stored,
  mirroring that repo's `activations.token_hash` /
  `lib/activation-token.js` pattern exactly.
- **`app/api/signup/route.ts`** - after the account insert commits,
  generates a token, inserts it (24h expiry), and sends the
  confirmation email - wrapped in its own try/catch so a send failure
  can't strand a person with a provisioned tenant and no way in; it's
  logged and the signup still succeeds.
- **`app/api/verify-email/route.ts`** (new) - the link target. No
  session required or checked - the token itself is the credential,
  same model as `casazium/license`'s own reissue-activation-token route.
  One-time use (deleted on any outcome, valid or not) and always
  redirects to `/dashboard` regardless of outcome - no separate
  success/failure query-param state to keep in sync; the banner below
  disappearing (or not) is the actual feedback.
- **`app/api/verify-email/resend/route.ts`** (new) + a small
  `EmailVerificationBanner` client component wired into
  `AppShellClient.tsx`, shown whenever the signed-in account's own
  `emailVerified` is `false` - piggybacks on `lib/session.ts`'s existing
  per-request `accounts` lookup (already there for `tenantId` and
  revocation) rather than a separate query, same reasoning as that
  field. Self-hosted mode never sees this at all -
  `emailVerified` is only ever populated under `MULTI_TENANT`.

### Verified end-to-end, not just by reading the diff

Real license server + real console standalone-equivalent dev server,
Playwright driving a real browser: signed up, confirmed the banner
shows, pulled the actual stub-logged confirmation link out of server
output, clicked it in the same browser session, confirmed the banner
disappeared. Separately verified resend generates a genuinely new,
distinct token and a fresh log line, and that clicking the resent link
also verifies correctly. Self-hosted mode regression-checked: logged in
as the shared admin user, confirmed the banner never renders (no crash,
no email/verification concept reachable at all). `npm run lint` and
`npm run build` both clean.

### What's still open

- No `sendPasswordReset` method or flow yet - that's the next natural
  increment once/if authorized, not built here.
- A verified account's other still-outstanding, unused tokens (e.g.
  from an earlier resend) aren't proactively invalidated once one
  succeeds - harmless in practice (re-verifying an already-verified
  account is an idempotent no-op, not a privilege escalation), noted
  rather than silently left unmentioned.
- `EMAIL_PROVIDER` has exactly one working value (`stub`) - no real
  email is sent anywhere yet. A real provider (Resend, SES, Postmark,
  etc.) is unauthorized, undecided, no task ID - same posture as
  `SaaS-C4`'s own note on real Stripe integration.

## 42. Real Resend EmailProvider (2026-08-05)

Operator had a Resend account and API key ready and asked to wire it
up. `lib/email/resend-provider.ts` (new) implements `EmailProvider`
against `POST https://api.resend.com/emails` directly via `fetch` - one
endpoint, one call shape, not worth adding the `resend` npm package as
a dependency for. `EMAIL_PROVIDER=resend` added to `lib/email/index.ts`'s
valid values, alongside the existing `stub`. New env vars documented in
`.env.example`: `RESEND_API_KEY` (required), `EMAIL_FROM` (optional,
defaults to Resend's own `onboarding@resend.dev` - deliverable to the
account's own verified address with no domain verification needed,
useful for exactly the quick real-send test this task was for).

**The real API key was never requested or seen by this session** - a
real third-party account credential is a different category from every
self-generated secret (`ADMIN_API_KEY`, `SESSION_SECRET`, etc.) used
elsewhere this session for local verification, and pasting it into chat
would put it at rest somewhere it doesn't need to be. Verified what's
verifiable without it instead: booted real license + console servers
with `EMAIL_PROVIDER=resend` and a deliberately fake key, signed up
through a real browser, confirmed signup still succeeded (the
best-effort try/catch around the send call, added in §41, held), and
confirmed the actual outbound request was correctly constructed and
reached the point of a real HTTPS call to `api.resend.com` - it failed
with a 403 from *this remote session's own sandbox network policy*
(outbound is allowlisted; that host isn't on it), not from Resend or
from any bug in the integration - confirmed by checking
`$HTTPS_PROXY/__agentproxy/status` directly rather than assumed. That
sandbox restriction doesn't apply on the operator's own machine, where
the actual real-send test happens next, with their own key in their own
local `.env.local`, never in this conversation.

`npm run lint` and `npm run build` both clean.

## 43. `.gitignore` env-file pattern broadened (2026-08-05)

Operator asked for an env-file convention audit against
`casazium/license`. This repo's own conventions (a checked-in
`.env.example`, Next.js's own built-in `.env.local` loading) were
already sound and needed no change - the actual gap was that repo's
own missing template plus a real bug in its documented Quickstart, both
fixed there (full record in `casazium/license/PROJECT_STATUS.md` §56),
alongside a second, independent instance of the `.env.test`-fallback
hazard that session's own §53 `.env.test` addition was meant to close.

One real gap found here: `.gitignore` only excluded `.env*.local` and
`.env` explicitly, not a blanket `.env*` the way `casazium/license`'s
own does - meaning a stray `.env.production` created here out of habit
from that repo's own (now-fixed) naming convention would **not** have
been gitignored. Broadened to `.env*` with a `!.env.example` exception,
matching `casazium/license` exactly. Verified directly, not assumed:
`.env.example` still shows as untracked-and-ignorable-exempt via `git
check-ignore`, and a deliberately-created test `.env.production` file
is now correctly caught by the new pattern (removed immediately after
confirming). `npm run lint` and `npm run build` both clean.

## 44. Password reset (2026-08-05)

The originally-identified email blocker (`SaaS-B1b`, §31 - "blocked on
an email-provider decision, deliberately deferred") is now fully
closed, following signup confirmation (§41) and the real Resend
provider (§42).

### What was built

- **`lib/one-time-token.ts`** (renamed from the now-deleted
  `lib/email-verification-token.ts`) - the generate/hash pair was
  already generic, only its name and doc comment claimed otherwise;
  password reset is a second real caller, so generalizing was
  justified now rather than duplicating identical crypto logic.
- **`lib/db/schema.sql`** - new `password_reset_tokens` table,
  deliberately separate from `email_verification_tokens` rather than a
  shared table with a "purpose" column - a compromised reset token
  means account takeover, a compromised confirmation token doesn't, and
  they carry different expiry windows (1h vs 24h) for exactly that
  reason. Real FK, hashed-at-rest, same reasoning as the existing table.
- **`lib/email/provider.ts`** - `sendPasswordReset(to, resetUrl)` added
  to the `EmailProvider` interface; implemented in both
  `stub-provider.ts` (logs) and `resend-provider.ts` (real send,
  refactored to share one internal `send()` helper with
  `sendSignupConfirmation` rather than duplicating the fetch/error
  boilerplate).
- **`app/api/forgot-password/route.ts`** (new) - public, IP-rate-limited,
  always returns the same generic success response regardless of
  whether the email matches a real account - the one place this
  deliberately differs from signup's own account-existence-leaking 409,
  since password reset has no legitimate reason to ever confirm or deny
  that to an unauthenticated caller.
- **`app/api/reset-password/route.ts`** (new) - public (token is the
  credential, not a session), validates + one-time-consumes the token,
  updates the password hash, calls `lib/session.ts`'s existing
  `revokeAccountSessions()` (built during `SaaS-B1c` for exactly this
  trigger, per its own header comment, and unused until now), then
  issues a fresh session so the browser completing the reset lands
  signed in - any *other* still-open session for the account is now
  invalidated.
- **`app/forgot-password/`** and **`app/reset-password/`** (new pages +
  client forms) - "Forgot password?" link added to the login page,
  `MULTI_TENANT`-gated same as the existing "Sign up" link.

### A real, previously-shipped bug found and fixed along the way

While verifying the reset flow in a logged-out browser context (not
just the same session used for signup, which is all prior testing this
session ever exercised), `proxy.ts`'s `PUBLIC_PATHS` list turned out to
be missing `/api/verify-email` entirely - meaning a person opening
their real confirmation link from a different browser, a different
device, or simply after their signup session had expired was silently
bounced to `/login` before the route ever ran, and their account never
got marked verified. This bug shipped with §41 and went undetected
because every verification test that session happened to reuse the
same signed-in browser context from signup. Reproduced directly with a
fresh, cookie-less browser context before fixing, and re-verified after:
the account is now correctly marked verified from a logged-out
context too (confirmed by then logging in fresh and checking the
verification banner is gone), even though landing on `/login` itself
right after the link click is still expected (`/dashboard`, the
route's own always-redirect target, correctly still requires its own
session).

`/forgot-password`, `/api/forgot-password`, `/reset-password`, and
`/api/reset-password` were added to the same list from the start, not
found missing after the fact.

### Verified end-to-end, not just by reading the diff

Full flow via Playwright against real running servers: sign up, sign
out, "Forgot password?" link visible and works, submit email, pull the
real reset link from server output, set a new password, land
auto-signed-in on `/dashboard`. Then: old password confirmed rejected,
new password confirmed working. Separately verified session
revocation specifically: a still-open session (a second browser
context, logged in before the reset) is correctly kicked to `/login`
on its next request after a *different* session resets the same
account's password. Self-hosted mode regression-checked: all three new
routes 404, "Forgot password?" link absent from the rendered login
page (`0` occurrences, checked directly, not just "presumably hidden by
the same conditional"). `npm run lint` and `npm run build` both clean.

## 45. README: fixed a stale claim, documented local SaaS-tier testing (2026-08-05)

Operator asked directly whether the combined local-testing setup
(both repos, wired together, `MULTI_TENANT=true`) that's been given
in conversation each session was written down anywhere. Checked rather
than assumed: it wasn't - `casazium/license`'s own README never
mentions `MULTI_TENANT` at all, that var is only documented for
`casazium/license`'s Coolify production path in its `DEPLOYMENT.md`,
and this repo's own README documented each SaaS-mode var individually
but never walked through running both services together.

Also found a real stale claim while checking: this README still said
*"Password-reset is not yet built — blocked on choosing an email
provider, deliberately deferred rather than guessed at"* - no longer
true since §41/§44. Fixed.

Added a new "Local SaaS-tier testing" section: start a real
`casazium/license` server, wire this console at it, optional real-vs-stub
email (`EMAIL_PROVIDER=resend`, defaulting to `onboarding@resend.dev`
- no domain verification needed for a quick real-send test), what to
try, and how to reset to a clean slate.

Verified by literally following the new section's own commands, not
just re-reading the prose: fresh `.env`/`.env.local` generated exactly
as documented, both servers booted, and a real Playwright pass through
every "Try it" bullet - signup, the verify-email banner appearing,
the in-app billing demo checkout completing, and the "Forgot password?"
link present after sign-out. Every step matched the doc exactly, no
corrections needed after the walkthrough.

## 46. Operator-confirmed: real password-reset email delivery works (2026-08-05)

Closes the one gap this session's own verification couldn't reach:
this sandbox's outbound network policy blocks `api.resend.com`
directly (confirmed via `$HTTPS_PROXY/__agentproxy/status`, §42), so
the Resend integration was only ever verified here with a deliberately
fake key against real request-construction, never an actual delivered
email. Operator tested password reset with `EMAIL_PROVIDER=resend`
and a real API key on their own machine and confirmed it works - a
real email reached a real inbox, the real link worked. §44's flow is
now confirmed working end to end in genuinely real conditions, not
just simulated ones.

## 47. README: explain the `.env` vs `.env.local` difference (2026-08-05)

Operator asked directly why the two repos differ on the local-dev env
filename. Not a bug or leftover inconsistency - confirmed by checking,
not assumed: this app has zero `dotenv` code anywhere (`grep` across
`lib`/`app`/config files came back empty besides an unrelated comment),
env loading is entirely Next.js's own built-in tooling, which
specifically designates `.env.local` for personal/uncommitted values.
`casazium/license` is plain Node/Fastify with a hand-rolled `dotenv`
call defaulting to plain `.env` - a different framework's own native
convention, not a choice either repo made independently. Added a short
note to that effect right at this README's own `.env.local` step, with
a matching note in `casazium/license`'s own README.

## 48. "Trigger 2": a tenant revoked on casazium/license locks this console out (2026-08-05)

The last remaining item from `lib/session.ts`'s original two-triggers
docblock (`SaaS-B1c`) - password reset (trigger 1) was built long ago;
this was the one flagged as unbuilt ever since. No task ID owns this;
operator asked for it directly after a design discussion.

### Design process, not just the outcome

Given three sketched options (reactive-on-403, a webhook, polling) and
asked which to build, operator asked for an Opus agent's independent
recommendation first, briefed with the real code (not just a summary)
rather than my own analysis alone. That review found real problems
with the *reactive* option's own naive framing before recommending
anything: the license server's 403 is deliberately identical for every
rejection reason (missing/unknown/revoked credential - a
credential-type-oracle guard, `require-tenant-scoped-access.js`'s own
comment), so a blanket "403 means revoked" rule would have wrongly
logged out a tenant who simply hit their plan's own quota (`quota.js`
also 403s, with a distinct message) - a real bug that was never
implemented, caught at the design stage instead. It also found that a
purely reactive check, with no durable state, can't actually lock
anyone out: login is a local password check with no license-server
call at all, and a fresh login always produces a token issued *after*
the point-in-time `sessions_revoked_at` watermark, so it would just
flap - revoked, then immediately usable again on next login.

Operator then asked specifically how serious the resulting reactive
design's own residual exposure (no push notification - the console
only finds out on its own next license-server call) actually is,
before approving a build. A second review pass, reading the real page
code rather than reasoning abstractly, found: only two authenticated
pages in the whole app make zero license-server calls
(`licenses/new`, `onboarding` - both empty/local-only), everything
else calls out on every render with no caching anywhere in the repo
(`dynamic = 'force-dynamic'`, `cache: 'no-store'` throughout), issuing
a license is blocked unconditionally and instantly regardless (the
license server's own auth hook, not this console, is what's
authoritative), and the console holds no mirror of tenant data to leak
- the tenant API key is encrypted at rest and has exactly one
server-side decrypt call site, never rendered. Verdict: a UX/staleness
issue, not a security one, and the threat model (the tenant's own
revoked operator, not a third party) narrows it further - the
revocation's real purpose, stopping new value extraction, is already
achieved unconditionally by the license server itself. **This is the
recorded reason that residual window is accepted, not re-litigated as
an open gap by a future reader of this code**, per that review's own
explicit recommendation to write exactly this down.

### What was built

- **`lib/db/schema.sql`** - `accounts.tenant_revoked_at`, a nullable
  watermark but checked as a persistent gate (`lib/session.ts`), not a
  point-in-time comparison like `sessions_revoked_at` - a revoked
  tenant must stay locked out of every *future* login too, not just
  whatever sessions existed when it was set. Deliberately a separate
  column, not the same watermark reused, for exactly that reason.
- **`lib/errors.ts`** - `isTenantRejected()`, matching the license
  server's own exact `'Unauthorized'` 403 message, alongside the
  existing `isOverQuota`/`isPaymentFailed` (which match their own
  distinct strings - the three can never be confused with each other).
- **`lib/license-client.live.ts`** - refactored all 14 of this file's
  own `!res.ok` throw sites through one new shared
  `throwForFailedResponse()` helper, so every 403 (not just
  `issueLicense`'s own quota/payment cases, which is as far as this
  went before) preserves the server's real error text - required for
  `isTenantRejected()` to have anything to classify.
- **`lib/tenant-context.ts`** - `markTenantRevoked(tenantId)` (a
  `WHERE tenant_id = ?` cascade, not `WHERE id = ?` - correct once
  `SaaS-B1b`'s one-account-per-tenant simplification is eventually
  lifted, matching `revokeAccountSessions`'s own documented intent for
  the same trigger) and `markIfTenantRejected()`, the actual shared
  call-site helper (one function, not the classify+mark pair
  duplicated at each site).
- **Reactive detection**: all 6 real call-site files (the same set
  `requireSessionWithTenantKey()`'s own header comment already
  enumerates - 3 read pages, 2 actions files covering 7 actions)
  now call `markIfTenantRejected()` in their existing catch block,
  alongside whatever they already checked - a side effect, not a new
  response variant; the existing `throw err` / `return {ok:false,...}`
  still runs unchanged right after.
- **Login-time probe** (`app/api/login/route.ts`) - one extra call to
  the already-existing `GET /billing/status` after the password check,
  before issuing a session - closes the fresh-login bypass a purely
  reactive check can't. **Fails open on anything except the exact
  `isTenantRejected` classification** - a network error, timeout, 5xx,
  or 429 here must not turn a transient license-server hiccup into a
  console-wide login outage; only an authoritative rejection blocks.

### Verified end-to-end against real servers, not just by reading the diff

Full real scenario via Playwright: signed up, confirmed the dashboard
works, looked up the real `tenant_id` from the console's own SQLite
file, called `POST /admin/tenants/:id/revoke` directly against a real
running license server, then continued the *same* browser session -
first post-revocation request failed (500, the reactive detection's
own side effect firing as designed), second request was redirected to
`/login` (the persistent-gate check now rejecting the session
outright), and a completely fresh login attempt in a new browser
context was blocked immediately with the same generic "Invalid
username or password" message (the login-time probe). Self-hosted
mode regression-checked separately: login still works normally, the
whole mechanism never engages (gated on `isMultiTenant()`).
`npm run lint` and `npm run build` both clean.

## 49. Independent Opus security review, three High findings fixed (2026-08-06)

Companion to `casazium/license`'s own `PROJECT_STATUS.md` §60 - same
operator request (an Opus review before any merge-to-main decision,
raised after a "what's left before the hosted tier can go live"
discussion), same method (an independent Opus subagent per repo, full
real-code access, adversarial testing against the real running app via
probe scripts, not a design read). This repo's half found three High
findings, no Critical; all three fixed and verified in this same
session, per operator's "start with critical and high" instruction.

### H1 (High, fixed): login brute-force protection was fully bypassable, two independent ways

`lib/login-rate-limit.ts`'s bucket was keyed by IP alone, and
`app/api/login/route.ts` cleared it entirely on any successful login.
Bypass A: 4 wrong guesses against a target account, then 1 correct
login against *any* account the attacker controls - trivial under
`MULTI_TENANT=true` self-service signup - reset the bucket, giving
unbounded guessing in cycles of 4. Bypass B, independent of A: the key
was derived from `X-Forwarded-For`'s *leftmost* entry with no trusted-
proxy boundary, so a client could set its own bucket to anything by
sending its own header.

**Fix**: `getClientKey()` now keys on `` `${identifier}|${ip}` ``, not
IP alone (`lib/login-rate-limit.ts`) - closes Bypass A's underlying
cause (an attacker's own accounts no longer share a bucket with the
account they're guessing) and the login route no longer clears the
bucket on success at all (leftover failures simply age out of the
fixed window). For Bypass B, IP resolution now reads
`trustedProxyCount()` (new, `lib/config.ts`, defaults to 1 - Coolify's
Traefik is the sole hop in every deployment this repo documents) hops
from the *right* of `X-Forwarded-For`, the ones actually appended by
the trusted proxy chain, not the client-suppliable left side.

Verified against a real running standalone build, not unit tests (this
repo has no test runner - see `package.json`): 4 wrong passwords, 1
correct login (200), 1 more wrong password, then a 6th attempt with
the *correct* password still got `429` - the old code would have let
it through, since the correct login at step 2 would have cleared the
bucket. Separately: 5 failed logins with a rotating spoofed leftmost
`X-Forwarded-For` hop but the same real (rightmost) hop all landed in
one bucket, and a 6th was blocked (`429`); a genuinely different real
IP got a fresh bucket, confirmed not blocked. `npm run lint` and
`npm run build` both clean.

### H2 (High, fixed): every emailed link resolved to an address no client can reach in the real deployment

`app/api/forgot-password/route.ts`, `signup/route.ts`,
`verify-email/resend/route.ts` (all three emailed links) and
`verify-email/route.ts` (the confirmation link's own redirect target)
all built URLs from `request.nextUrl.origin`. Next 16 pins a route
handler's resolved origin to the server's *configured* hostname/port,
not any request header - `Dockerfile`/`docker-compose-coolify.yml` set
`HOSTNAME=0.0.0.0` with `PORT` unset (⇒ 3000), so in the real shipped
deployment every password-reset and signup-confirmation email
contained `https://0.0.0.0:3000/...` - unusable, not exploitable. This
directly contradicts §46's own "real password-reset email delivery
works" note, which was almost certainly verified under `next dev`,
where the resolved origin happens to be `localhost` instead.

**Fix**: new `publicBaseUrl(request)` (`lib/config.ts`) - reads a new
required `PUBLIC_BASE_URL` env var, throwing in production if it's
unset (same fail-loud convention as `lib/license-client.ts`'s
`LICENSE_STANDALONE_MODE` check) rather than silently emailing broken
links; falls back to the request's own origin in development, where
it happens to be correct, so `npm run dev` keeps working with no
`.env` at all. All four call sites switched to it.
`docker-compose-coolify.yml`, `.env.example`, and `DEPLOYMENT.md`
updated to document the new required var.

Verified against a real standalone build in both directions: with
`PUBLIC_BASE_URL` unset and `NODE_ENV=production`, `GET
/api/verify-email?token=...` returned `500` (fails loud, doesn't
redirect to a broken origin); with it set to
`https://console.example.com` and a real account inserted directly
into the console's own SQLite file, `POST /forgot-password` produced a
stub-logged link of exactly `https://console.example.com/reset-password?token=...`
- confirmed by reading the actual server log line, not assumed.
`npm run lint` and `npm run build` both clean.

### H3 (High, fixed): signup itself had no effective rate limit

`app/api/signup/route.ts` called `recordFailedLoginAttempt()` only on
validation failures and the duplicate-email `409` - never on a
*successful* signup - and `clearLoginRateLimit()` on success actively
wiped out any prior failures too. A loop of valid signups (each one a
real `POST /admin/tenants` call to `casazium/license` using this
console's own privileged `LICENSE_ADMIN_API_KEY`, a real scrypt hash,
and - under `EMAIL_PROVIDER=resend` - a real outbound email) was never
rate-limited at all.

**Fix**: `checkLoginRateLimit()` (`lib/login-rate-limit.ts`) gained an
optional `maxAttempts` override; signup now passes a distinct
`SIGNUP_MAX_ATTEMPTS = 3` (lower than login's default 5 - each attempt
here is a real network call plus a real email send, much costlier per
attempt than a password check), counts a successful signup toward the
bucket via `recordFailedLoginAttempt()`, and no longer clears it on
success.

Verified end-to-end against two real running servers (a real
`casazium/license` instance, `MULTI_TENANT=true`, plus this console
pointed at it) - not mocked: 4 consecutive valid signups from the same
IP, each with a distinct email/tenant name. The first 3 succeeded
(`200`), each provisioning a real tenant on the license server (read
back directly from both the console's own `accounts` table and
confirmed exactly 3 rows, not simulated); the 4th was rejected with
`429 Too many signup attempts`. `npm run lint` and `npm run build`
both clean.

### What's still open (Medium/Low, not in this pass's scope)

The review's own remaining findings for this repo - timing-based user
enumeration on both login and password-reset, signup enumeration via
HTTP status code, a completed password reset not invalidating that
account's *other* outstanding reset tokens, an unbounded rate-limit
`Map` (memory growth via header rotation), and - notably -
`tenant_revoked_at` (this session's own "Trigger 2" work) having no
path to clear itself once set, which the review flagged as worth
revisiting now that it's a known gap rather than a theoretical one -
are Medium severity and were explicitly not part of this pass
(operator: "start with critical and high"). Not fixed yet; tracked for
the next authorized pass, not silently dropped.

## 50. All six Medium findings fixed (2026-08-06)

Operator: "continue into the medium findings too," directly following
§49's own closing punch list. Companion to `casazium/license`'s own
PROJECT_STATUS.md §61.

### M1 (fixed): login timing-based user enumeration

`lib/auth.ts`'s `verifyCredentials()` returned immediately on
`!account`, skipping `verifyPassword()`'s scrypt computation entirely -
measurably faster for a nonexistent email than a real one. Fixed with a
fixed, non-secret `DUMMY_PASSWORD_HASH` (`salt:hashHex` shape, not a
real password's hash) - `verifyPassword()` now always runs against
*something*, account or not, before the existence check is applied to
the result. Verified against a real running standalone build: after
warmup, both an existing and a nonexistent account respond in ~4-6ms,
statistically indistinguishable (the timing gap the review measured no
longer exists).

### M2 (fixed): forgot-password latency enumeration

`app/api/forgot-password/route.ts` awaited the real email send only
when an account exists - under `EMAIL_PROVIDER=resend` (production)
that's a real network round trip, only paid for real accounts, despite
the response body being identical either way. Fixed by no longer
awaiting the send (fire-and-forget, still `.catch()`-logged). Verified
by temporarily adding a 300ms artificial delay to the *stub* provider's
own `sendPasswordReset` (reverted immediately after, `git diff` confirms
clean) - responses for both an existing and a nonexistent account stayed
at ~10ms despite the delay, and the stub's own log line still confirmed
the email genuinely gets sent afterward, not silently dropped.

### M3 (accepted tradeoff, documented not fixed): signup enumeration via status code

`app/api/signup/route.ts` returns `409` for an already-registered email
vs `200`/`400`/`500` otherwise - the status code confirms registration
even though the message is generic. Reviewed both options the finding
offered (fix to full anonymity, matching forgot-password; or accept and
document) and chose the latter: unlike password reset, which has no
legitimate reason to ever confirm registration to an unauthenticated
caller, telling someone at signup time "this email is already
registered, try logging in instead" is the ordinary UX almost every
product uses - hiding it would trade a minor enumeration signal for a
confusing signup flow in the common, legitimate case of someone
re-signing-up with their own account. The comment claiming full
anonymity (which the status code never actually delivered) is replaced
with one stating the real, accepted tradeoff.

### M4 (fixed): password reset didn't invalidate sibling tokens

`reset-password/route.ts` deleted only the one token just redeemed,
leaving any *other* outstanding reset token for the same account still
valid for the rest of its TTL - a real account-retake scenario
(attacker with brief mailbox access requests a reset and saves the
token; the victim notices, resets via their own separate link; the
attacker's saved token was still redeemable and could re-take the
account, undoing the victim's own remediation). Fixed: on a successful
reset, every other outstanding `password_reset_tokens` row for that
account is now deleted too. Applied the same pattern to
`verify-email/route.ts`'s `email_verification_tokens` for consistency.
Verified against a real running server with two real tokens for one
account (an "attacker's captured" one and the "victim's own" one):
redeeming the victim's token succeeded, and the attacker's previously-
valid token immediately started returning "Invalid or expired reset
link."

### M5 (fixed, real design work): `tenant_revoked_at` had no recovery path

The hardest of the six - genuinely needed a design decision, not a
one-line fix. Investigated the review's own named trigger
(`ACCOUNT_ENCRYPTION_KEY` rotation) before designing around it: traced
`lib/crypto.ts`'s `decrypt()` and confirmed a wrong key makes AES-GCM's
auth-tag check throw a raw crypto exception, not a `LicenseApiError`
with `status: 403` - `isTenantRejected()` wouldn't match it, so that
*specific* trigger likely 500s rather than setting the gate. The
finding's core concern stood regardless under a more realistic trigger
that does go through the real 403 path: a tenant's API key rotated via
`casazium/license`'s own admin-only `rotate-tenant-key.js` without this
console being updated, or any other reason the server-side lookup stops
matching a credential this console still holds - genuinely
indistinguishable from real revocation at the console's own API
surface, and previously permanent.

Design: the only place in the whole app a *successful* license-server
call can ever run while this gate is set is the login-time probe
(`app/api/login/route.ts`) - `lib/session.ts`'s persistent-gate check
rejects the session before any page/action body (where every other
license-server call happens) is ever reached, so a revoked account has
no other code path available to prove itself un-revoked. New
`clearTenantRevoked()` (`lib/tenant-context.ts`) is called from exactly
that one place, on a successful probe response - real, current proof
the credential is valid right now, the same authority `markTenantRevoked()`
itself already relies on for the opposite outcome. Self-healing, not a
weakening: the gate still blocks unconditionally the instant a real
rejection is seen, and only clears on a subsequent *proven* success, not
an assumption.

Verified end-to-end against two real running servers, not simulated:
signed up a real tenant, revoked it via a real `POST /admin/tenants/:id/revoke`
call, confirmed login was blocked and `tenant_revoked_at` was set in the
console's own database, reactivated the tenant on the license server
(direct DB write - no un-revoke endpoint exists on that server, a
separate, pre-existing gap out of this pass's scope), then confirmed a
fresh login attempt succeeded *and* `tenant_revoked_at` read back as
`NULL` - no manual database intervention needed anywhere in the cycle.

### M6 (fixed): unbounded rate-limit `Map`

`lib/login-rate-limit.ts`'s `buckets` Map only evicts an entry when
*that same key* is next checked after its window expires - a caller
that never revisits a key (many distinct real users over time, or one
rotating identifier/IP combinations) leaves entries sitting forever
with nothing to remove them. Fixed with a `MAX_BUCKETS = 50_000` cap,
enforced opportunistically (only when actually about to grow past it,
not on a timer): sweep anything already expired first, then fall back
to evicting the single oldest entry if still at the cap. Verified via a
temporary standalone harness (Node's `--experimental-strip-types`
against a `/tmp` copy of the real module, not a reimplementation - the
copy was deleted immediately after, nothing shipped): inserted 60,000
distinct keys, confirmed the earliest one was evicted (came back
"fresh," no longer rate-limited) while a recent one was still correctly
tracked.

`npm run lint` and `npm run build` both clean after every fix, not just
at the end.

## 51. All eight Low findings resolved (2026-08-06)

Operator: "continue into the low findings too," directly following
§50's own closing note. Companion to `casazium/license`'s own
PROJECT_STATUS.md §62. Six fixed, two confirmed already mitigated as a
side effect of earlier fixes in this pass - no code change forced where
nothing was actually still broken.

### L1 (fixed): `/api/logout` required a session

Not in `proxy.ts`'s `PUBLIC_PATHS` - an unauthenticated `POST
/api/logout` (an expired-but-still-present cookie, most commonly) got
307'd to `/login` before the route ever ran, so the cookie-clearing
`Set-Cookie` never went out. The route itself has no session check at
all and nothing sensitive to protect - its *absence* from the list was
the bug. Added. Verified against a real running server: an
unauthenticated `POST /api/logout` now returns a real `200` with a
real cookie-clearing `Set-Cookie` header, no redirect.

### L2 (confirmed already decided, no change): email verification gates nothing

Not a new finding to act on - the operator was asked directly earlier
this session ("so what happens if you don't verify your email
address?") and explicitly chose nag-only ("Keep it nag-only for now").
The review flagging this independently is useful confirmation the
current behavior matches that decision, not a signal to revisit it.

### L3 (fixed): latent stored XSS in the branding title

`BrandTitle.tsx` rendered `titleHtml` via `dangerouslySetInnerHTML`
unconditionally, and `lib/branding.ts`'s `getBranding()` now sources
that value from `tenant_branding.title_html` (a DB column) as well as
the original, genuinely-trusted `BRANDING_TITLE_HTML` env var -
`BrandTitle.tsx`'s own comment ("titleHtml is operator-controlled
config... not user input") stopped being true for the DB path the
moment `SaaS-B3` added it, even though nothing writes that table today
(confirmed - dormant, not live). Fixed by carrying the trust
distinction on the data itself: `Branding` gained a `titleIsHtml`
field, `true` only for the env-var source, `false` whenever a tenant's
own DB value is actually used - `BrandTitle` only uses
`dangerouslySetInnerHTML` when the caller asserts `isHtml`, rendering
as plain (React-escaped) text otherwise. All 4 real call sites (login,
signup, forgot-password, reset-password pages) updated to pass the new
flag. Verified by inserting a real `<img src=x onerror=...>` payload
into `tenant_branding` against a real DB and confirming `getBranding()`'s
own query/logic (replicated exactly, including the real SQL) resolves
it to `titleIsHtml: false` - the render-time conditional itself is a
single, type-checked line, already confirmed correct by a clean build.

### L4 (fixed): token tables never pruned

`email_verification_tokens`/`password_reset_tokens` rows only ever
deleted themselves individually on successful use - a token nobody
redeems (an abandoned signup, an unclicked reset link) sat past its own
expiry forever. Fixed with the same pattern `casazium/license` already
uses for `tenant_auth_log` retention (that repo's `PROJECT_STATUS.md`
§62's own L8 note): prune by `expires_at` once at DB open, then on an
`unref()`'d daily interval, in `lib/db.ts`. Verified against a real
database: inserted one expired reset token, one valid reset token, and
one expired verification token directly, booted the real app (which
opens the DB and runs the prune), and confirmed only the expired rows
were gone afterward - the valid one survived untouched.

### L5 (fixed): `/api/reset-password` was missing its `isMultiTenant()` gate

Every sibling SaaS-only route (`signup`, `forgot-password`) and page
404s under self-hosted; this one didn't - harmless in practice (an
empty `accounts` table under self-hosted means no token could ever
match anyway) but inconsistent with the stated posture, and worth being
explicit rather than relying on that being incidentally true forever.
Added the same gate. Verified against a real server with
`MULTI_TENANT` unset: `POST /api/reset-password` now returns a real
`404`.

### L6 (confirmed already mitigated, no code change): `X-Forwarded-Proto` trusted for the emitted scheme

Checked rather than assumed. The only place this ever mattered -
`request.nextUrl.origin` resolution - is now excluded from production
entirely by the H2 fix (`PUBLIC_BASE_URL` is used instead, never
derived from any request header once set, and production throws if
it's unset). The one remaining internal use (`proxy.ts`'s `/login`
redirect) only ever borrows a scheme for a same-host redirect - the
host itself was never spoofable, confirmed during H2's own
investigation - and this app already sends
`Strict-Transport-Security` site-wide, which forces real browsers to
upgrade regardless of what scheme a redirect's own `Location` header
specifies. No further action needed.

`npm run lint` and `npm run build` both clean after every fix, not just
at the end.

## 52. Second, deliberately unbiased Opus security review - all findings fixed (2026-08-06)

Operator: "i plan on doing a coolify deployment today. first, opus
should do another independent security audit of both repos. opus
should not have any previous knowledge of the repos." - a second review
round, run with fresh agents given none of §49-51's own context, ahead
of a real production deployment. Companion to `casazium/license`'s own
PROJECT_STATUS.md §63. The operator asked to continue straight through
every severity in one pass ("let's continue now with vulnerabilities
found by audits"), not tier-by-tier this time.

### FRESH-L-EMAIL (fixed): `docker-compose-coolify.yml` never wired `EMAIL_PROVIDER`/`RESEND_API_KEY`/`EMAIL_FROM`

`lib/email/index.ts`'s `getEmailProvider()` throws in production+multi-tenant
if `EMAIL_PROVIDER` is unset (mirrors `license-client.ts`'s
`getBackendMode()` fail-loud convention), but the Coolify compose file's
`environment:` block never listed any of the three env vars a real
`resend` deployment needs - a real Coolify deployment following only
this file would have booted straight into that throw. Added all three,
plus `TRUSTED_PROXY_COUNT`, with header comments. `DEPLOYMENT.md`
gained a step documenting the requirement.

### FRESH-L-DOCKERIGNORE (fixed): no `.dockerignore`, `.env*` baked into the image

No `.dockerignore` existed at all - `COPY . .` in the Dockerfile plus
`scripts/copy-standalone-assets.mjs`'s own env-file-copying step meant
any local `.env`/`.env.local` sitting in the build context landed
inside the image layers. New `.dockerignore`: blanket `.env*` exclusion
(with `!.env.example`), `node_modules`, `.next`, `.git`, `.github`,
`*.md` (except README), `/data/`, `*.db*` - mirrors `.gitignore`'s own
exclusion shape.

### FRESH-L-DOS (fixed): unbounded username enabled memory-exhaustion DoS via the login rate limiter

`getClientKey()` combined the raw, attacker-controlled `username` string
directly into the rate-limit Map's key - a request with a multi-megabyte
username retained that entire string in memory per distinct value, with
no cap. **Fix**: `getClientKey()` now SHA-256 hashes the identifier
before combining with IP - a constant 71-character retained key
(64-hex-char hash + separator + IP) regardless of input length.
Verified directly: copied `lib/login-rate-limit.ts` to a scratch module
with `.ts`-suffixed import paths, ran it under
`node --experimental-strip-types`, called `getClientKey()` with an 8MB
input, confirmed the retained key is exactly 71 characters - the actual
fix, isolated from transient HTTP-layer/V8-allocator memory noise that
initially confounded a naive RSS-based test.

### FRESH-S-QUOTA (confirmed accepted, documented only): `BILLING_PROVIDER=stub` lets any fresh tenant self-upgrade to `pro` for free

Not a gap - the operator's own explicit, already-stated decision this
session: "we are not setting up payments... i just want to get a
version out there for people to play with." `stub-provider.js`'s own
documented default (no `billing_subscriptions` row = `'active'`) is
what makes a brand-new tenant's first checkout land on `pro` with
nothing to pay - real for as long as `BILLING_PROVIDER=stub` is the
live config, which it is. The console's own `PlanSelector` UI already
labels this "Demo checkout." `casazium/license`'s
`billing-complete-stub-checkout.js` docblock extended (comment-only) to
record this explicitly rather than leave it implicit; revisit the
moment real payments are wired up, not before.

### FRESH-M-CONCURRENCY (fixed): the rate limiter's check-then-increment was a real, exploitable race

The old two-step API (`checkLoginRateLimit()` then, after `await
verifyCredentials()`'s scrypt call, `recordFailedLoginAttempt()`) left a
window where concurrent requests could all pass the check at the same
count before any of them recorded. Confirmed live: 60 concurrent
wrong-password logins let 19 through against a limit of 5.

**Fix**: `lib/login-rate-limit.ts` rewritten around one atomic primitive,
`checkAndReserveAttempt()` (checks and increments in one synchronous
call - no `await` in between) plus `refundAttempt()` (undoes exactly
one reservation, for login's existing "successes don't count" design).
Applied to all four routes with a check-then-record shape: login,
signup, reset-password, forgot-password. Reverified the same 60-concurrent
scenario post-fix: exactly 5 allowed through, matching the configured
limit precisely.

### FRESH-M-PERIP (fixed): no per-IP cap meant password-spraying across many accounts was unbounded

The per-account+IP bucket (this session's own earlier H1 fix) closed
cross-tenant lockout but, as a side effect, removed any ceiling on
trying one guessed password against many *different* accounts from one
IP. Confirmed live: 35 sequential logins with 35 distinct usernames from
one IP, never a `429`.

**Fix**: added a second, looser `perIpKey` bucket (`login-ip:` prefix,
`IP_MAX_ATTEMPTS = 30`) alongside the per-account one in
`app/api/login/route.ts` - high enough to never fire on a real user
mistyping their own password, low enough to bound genuine spraying. On
a per-IP rejection, the per-account reservation is explicitly refunded
first (the request never became a real attempt against that specific
account). Reverified: exactly 30 distinct-username attempts allowed
from one IP before `429`.

### FRESH-M-EMAILCASE (fixed): case-sensitive email caused duplicate accounts and silent lockout

SQLite `=` on `TEXT` is case-sensitive; `accounts.email` lookups/inserts
used the raw string. Confirmed live: signing up `alice@example.com`
then `Alice@example.com` both succeeded as two distinct accounts backed
by the same real mailbox - and a user who signs up as `Bob@corp.com`
then later types `bob@corp.com` gets silently locked out (generic
"invalid username or password," and forgot-password's own lookup missed
too, so no recovery email ever went out either).

**Fix**: new `normalizeEmail()` (trim+lowercase) in `lib/auth.ts`,
applied at every read/write site - login (`verifyCredentials`), signup,
forgot-password. `lib/db/schema.sql`'s `accounts.email` column also
gained `COLLATE NOCASE` as a defense-in-depth backstop (handles case,
not the whitespace `normalizeEmail()`'s own `trim()` covers). Verified
directly with `better-sqlite3`: confirmed both lookups and the unique
index inherit case-insensitivity from the column-level collation
without needing to repeat it on the index.

### FRESH-M-CSRF (fixed): no CSRF/Origin check on Route Handlers - login CSRF was live

Route Handlers (unlike Server Actions, which Next protects
automatically) had no Origin verification at all. Login and signup are
the two routes that don't require an existing session cookie
(everything else is already protected by `SameSite=lax`), so they were
reachable from a foreign origin. Confirmed live: a cross-origin
`text/plain` POST (bypassing the browser's own preflight, since
`text/plain` is a CORS-simple content type) to `/api/login` succeeded
and set a real session cookie in the victim's browser for an
attacker-chosen account - a classic login-CSRF, able to log a victim
into an attacker-controlled tenant.

**Fix**: new `isSameOrigin()` in `lib/config.ts` - compares the real,
browser-controlled `Origin` header against `publicBaseUrl()`, fails
closed (rejects) if `Origin` is missing or mismatched. Added as the
first line of both `login` and `signup` route handlers, before the rate
limiter or body parsing even run. Reverified the same cross-origin
`text/plain` POST: now a real `403 Invalid request origin`, no cookie
set.

### FRESH-M-MTFAILOPEN (fixed): `MULTI_TENANT` unset while real SaaS accounts exist let a still-valid session silently fall back to platform-wide admin access

If `MULTI_TENANT` was ever dropped while the `accounts` table still
held real rows, `verifyCredentials()` falling back to the single shared
`ADMIN_UI_USERNAME`/`PASSWORD` pair blocks *new* logins for real
accounts - but the deeper hole was `verifySessionToken()`: its
`isMultiTenant()` branch is the *only* place that looks up `tenant_id`,
checks `tenant_revoked_at`, and checks `sessions_revoked_at`. Skip that
whole branch and any still-unexpired JWT issued while `MULTI_TENANT` was
on - including one for a since-revoked tenant - keeps verifying as a
valid, tenant-less `'admin'` identity. Every license-server call that
identity then makes falls through `license-client.live.ts`'s own
`resolveApiKey()` to the single shared `LICENSE_ADMIN_API_KEY`, since
`isMultiTenant()` is false there too - an existing SaaS session
silently gets platform-wide admin access instead of just its own
tenant's.

**Fix**: `lib/db.ts`'s `openDatabase()` now refuses to start
(`throw`) when `!isMultiTenant()` but `SELECT COUNT(*) FROM accounts`
is nonzero - mirrors `casazium/license`'s own equivalent guard
(that repo's PROJECT_STATUS.md §63) added in the same pass. A
genuinely fresh self-hosted install has an empty `accounts` table and
boots normally. Verified with a real `.ts`-native script (Node's
`--experimental-strip-types`, patched relative imports, run from a
scratch directory under this repo so `better-sqlite3` resolves): seeded
one real account row directly, confirmed `getDb()` throws with
`MULTI_TENANT` unset against that seeded DB, boots normally with
`MULTI_TENANT=true` against the same DB, and boots normally with
`MULTI_TENANT` unset against a genuinely empty DB - all three confirmed
against the real compiled `lib/db.ts` logic, not a mock.

### FRESH-L-PRUNEBUG (fixed): token-pruning date comparison had a real bug (found in code written this session)

`email_verification_tokens`/`password_reset_tokens` accumulate a row per
signup/resend/forgot-password request; each deletes itself on
successful redemption, but an unredeemed token (an abandoned signup, an
unclicked reset link) sat past its own expiry forever. The prune
queries compared the raw `expires_at` column (a JS-generated ISO-8601
string, e.g. `"2026-08-06T13:00:00.000Z"`) directly against SQLite's
`datetime('now')`, whose own output is space-separated with no
milliseconds or `'Z'` (`"2026-08-06 13:00:00"`) - SQLite has no native
`DATETIME` type, so this compares as `TEXT`, lexically, and `'T'`
(`0x54`) sorts after `' '` (`0x20`). Confirmed: a token that expired one
minute ago still compared as not-expired. Redemption itself was never
affected (`reset-password.ts`/`verify-email/route.ts` both use a real
`new Date(...) < new Date()` JS comparison, not this query) - retention
hygiene only, not a security hole, but a real bug regardless.

**Fix**: wrapped both sides in `datetime()` so they compare in the same
normalized representation. Verified against a real database (and after
remembering to `npm run build` first - the standalone server runs
compiled `.next/standalone/server.js`, so a source-only edit tested
against a stale build silently didn't reproduce the fix on the first
attempt): inserted a token that expired one minute ago, confirmed the
old query missed it and the fixed one prunes it correctly.

### FRESH-cleanup (done): stray real-secret-shaped `.env` files removed

Prompted by the fresh audit's own note to check for stray env files.
`/workspace/license/.env` and `/workspace/license-console/.env.local`
both found, both containing test-shaped (dummy) secrets left over from
this session's own extensive real-server verification work, both
confirmed gitignored and never committed. Deleted.

### Low/Informational findings triaged

- **scrypt cost parameter below current guidance (fixed)**: Node's
  `crypto.scrypt()` defaults to `N=16384` (2^14); OWASP's current
  Password Storage Cheat Sheet's own minimum is `N=2^17` (131072),
  `r=8`, `p=1`. `lib/password.ts`'s `hashPassword()`/`verifyPassword()`
  now pass those explicitly (plus `maxmem: 256MiB`, since scrypt needs
  roughly `128 * N * r` bytes - about 128MiB here - well past Node's own
  32MiB default ceiling). Safe to change now, not after the fact: the
  stored format has no versioning (`salt:hashHex`, no embedded cost
  parameters), so bumping `N` after any real account exists would
  silently break every existing user's login - this repo has no real
  deployed accounts yet (this is still the first real Coolify
  deployment), so this was the one moment to land it for free. Verified
  timing (~390ms per hash/verify, acceptable for an interactive
  login/signup path) and correctness (`hashPassword`/`verifyPassword`
  round-trip, wrong password still rejected) via a real scratch script.
- **No max-length on signup/login/reset/forgot-password inputs
  (fixed)**: none of `email`/`password`/`tenantName`/`username`/`token`
  across `signup`, `login`, `reset-password`, and `forgot-password` had
  an upper bound. Each successful reservation runs real cost regardless
  (regex validation, `hashPassword()`'s scrypt pass - whose cost scales
  with input size, not just the fixed `N`/`r`/`p` above - a real
  outbound tenant-provisioning call on signup, a DB write) - bounded
  today by each route's own tight rate limit, but no reason to let any
  of it run against megabytes of input regardless. Added
  `MAX_EMAIL_LENGTH` (254, RFC 5321's own mailbox limit),
  `MAX_PASSWORD_LENGTH` (256), `MAX_TENANT_NAME_LENGTH` (200),
  `MAX_USERNAME_LENGTH` (254), and `MAX_TOKEN_LENGTH` (128, generous
  margin over `generateOneTimeToken()`'s real 32-character output) to
  the relevant route files, matching this repo's own existing
  convention of small per-file constants (`MIN_PASSWORD_LENGTH` is
  already duplicated the same way across four files) rather than
  introducing a new shared module. Verified against a real running
  server, built and booted fresh: an oversized password/email on
  signup and an oversized password on login both now return a real
  `400` before doing any real work; a normal-length login still reaches
  `verifyCredentials()` (a real `401`, not a `400`) - the length gate
  doesn't block legitimate input.
- **Logout not invalidating the JWT (fixed)**: `/api/logout` only ever
  cleared the browser's cookie - sessions are stateless 8h JWTs
  (`lib/session.ts`'s own header comment), so a copy of the token made
  before logout (XSS, a shared/compromised machine, a proxy log) kept
  verifying as valid for up to 8 more hours regardless. Fixed by reusing
  `revokeAccountSessions()` - the same `sessions_revoked_at` watermark
  password-reset already bumps - rather than inventing a second
  mechanism; deliberately coarse (revokes every session for the
  account, not just the one device logging out), the same accepted
  tradeoff that function's own comment already documents. Self-hosted
  has no accounts row to revoke (gated behind `isMultiTenant()`, same as
  every other SaaS-only behavior in this repo). Verified against a real
  running server end-to-end: seeded a real account with a real scrypt
  password hash, logged in for a real session cookie, confirmed a
  protected route (`/api/verify-email/resend`) accepts it (`200`),
  called `/api/logout`, then replayed the *pre-logout* cookie snapshot
  against that same protected route - now a real `401`, and the DB
  confirms `sessions_revoked_at` was actually set. (First attempt showed
  the old token still verifying post-logout - not the documented
  same-second `iat` edge case, but a stale standalone build tested
  before the required `npm run build`; rebuilding and rerunning
  confirmed the real fix.)

`npx tsc --noEmit` and `npx eslint .` both clean across the whole repo
after every fix in this section, not just at the end. No automated test
suite exists in this repo (per this repo's own README/CLAUDE.md note),
so every fix above was verified against a real running
`.next/standalone/server.js` instance or a real compiled-module script,
matching this whole security-review pass's own established discipline.

## 53. Third, independent Opus security review - all findings fixed (2026-08-06)

Operator: "let's have opus do one more complete independent security check
for these repos before we continue," directly following §52's own
second round. Companion to `casazium/license`'s own PROJECT_STATUS.md
§64. Two fresh Opus agents, each given zero context on the other or on
any prior round, one per repo, run in parallel. This one found a real
structural hole in §52's own `MULTI_TENANT` fail-open fix - the guard
existed and was documented as closing the gap, but never actually ran
on the vulnerable path.

### H-1 (fixed): the `MULTI_TENANT` boot guard from §52 never ran on the actual vulnerable path

`lib/db.ts`'s guard (added in §52/FRESH-M-MTFAILOPEN, refusing to boot
if `MULTI_TENANT` is off but the `accounts` table has real rows) only
fires the first time something calls `getDb()`. On the exact path that
matters - a still-unexpired SaaS session JWT being verified after
`MULTI_TENANT` gets dropped - *nothing* calls `getDb()` at all:
`verifySessionToken()`'s entire DB-touching branch is itself gated
behind `isMultiTenant()`, so it's skipped, not run-then-guarded.
Confirmed live: replayed an existing SaaS session cookie against a
restart with `MULTI_TENANT` unset - it verified successfully, and the
console sent the platform-wide `LICENSE_ADMIN_API_KEY` to the license
server on that tenant's behalf, not their own key. Separately
confirmed: forcing the guard to fire via a *different* route
(`/api/verify-email`, one of the few paths that does call `getDb()`)
just 500'd that one request - `openDatabase()` throwing doesn't stop
the Next.js process, it just leaves the DB handle unset for next time.
Every other route kept serving normally with the escalated key.

**Fix**: two independent layers, matching the audit's own two suggested
directions - implemented both, not either/or.

1. **A `mode: 'saas' | 'selfhosted'` claim embedded in the session JWT
   at issuance** (`lib/session.ts`'s new `SessionMode` type,
   `Identity.mode`), set in `verifyCredentials()` (both branches),
   `signup/route.ts`, and `reset-password/route.ts`. `verifySessionToken()`
   now rejects a `saas`-mode token outright when `!isMultiTenant()`, as
   its very first check - before ever touching `isMultiTenant()`'s own
   DB-gated branch, so this needs no database access at all and can't be
   silently skipped the way the DB-based guard was. A token with a
   missing or invalid `mode` claim is also rejected (tightens tampered/
   pre-this-fix token handling as a side effect). Verified with a
   database-call-counting stub in place of `lib/db.ts` (no real DB
   connection at all): replaying a `saas`-mode token after `MULTI_TENANT`
   drops now returns `null` with the stubbed `getDb()` never invoked -
   confirmed 0 calls, proving the rejection happens before any DB
   dependency, not just that it eventually returns null. Self-hosted
   tokens and normal `MULTI_TENANT=true` operation both confirmed
   unaffected (DB still consulted exactly once, as before).
2. **The DB guard now actually halts boot.** New `instrumentation.ts`
   calls `getDb()` eagerly in `register()` (Node.js runtime only - Edge,
   which `proxy.ts`'s middleware also runs under, doesn't have
   `better-sqlite3`), and `process.exit(1)`s on failure instead of
   relying on an uncaught rejection during Next's own startup sequence
   to have the intended effect. Verified against the real standalone
   server three ways: `MULTI_TENANT` unset against a DB seeded with one
   real account now exits with code 1 and a logged fatal error *before
   the process ever starts listening* (confirmed via `timeout` - no port
   ever opens); `MULTI_TENANT=true` against that same DB boots and stays
   up; `MULTI_TENANT` unset against a genuinely empty DB (real
   self-hosted case) also boots and stays up.

Both layers matter independently: layer 1 closes the hole even if a
future code path opens its own DB connection differently and bypasses
the boot guard; layer 2 means the vulnerable *state* (server running
with `MULTI_TENANT` off against real SaaS data) can no longer be reached
via a normal restart/redeploy at all, which is the actual real-world
trigger (`DEPLOYMENT.md` already documents Coolify silently dropping an
env var on redeploy as a known failure mode).

### Medium findings fixed

### M-1 (fixed): `/api/login` buffered and parsed the full request body before any rate limiting

Confirmed live: an 8MB body containing valid credentials returned a
real `200` with a session cookie, proving the entire oversized body was
buffered and JSON-parsed at zero rate-limit cost to the caller - every
other auth route reserves its rate-limit bucket before parsing;
`login` was the one outlier.

**Fix**: reordered so the per-IP bucket (`checkAndReserveAttempt`,
keyed purely on IP, no body needed) runs first, before `request.json()`
- only requests that already clear it ever pay the parse cost. The
per-account bucket still runs after parsing (it's keyed on the
submitted username, which doesn't exist yet), unavoidable and
unchanged. Refund semantics were re-derived, not just carried over: a
per-account rejection no longer refunds the per-IP reservation (the
reverse of the old ordering's own refund direction) - that request
genuinely was real traffic from that IP targeting a real, rate-limited
account, and refunding it would let an attacker dodge the per-IP spray
guard by deliberately hammering an already-locked account. Verified
against a real server: exactly 30 sprayed attempts (distinct usernames,
one IP) allowed before `429`, unchanged from before; a 31st request
carrying a 5MB body while already IP-rate-limited returns `429` in 21ms,
confirming the body is never parsed once the cheap check rejects first.

### M-2 (fixed): scrypt's stored hash format had no versioning - last chance to fix before real signups exist

`lib/password.ts`'s cost parameters were already bumped to OWASP's
current `N=2^17` minimum in §52's own Low-findings pass, but the stored
format (`salt:hashHex`) never recorded which cost parameters produced a
given hash. Changing `SCRYPT_N` again in the future would silently break
every already-issued hash, since `verifyPassword()` always re-derived
using *today's* constants, not the ones that made the original hash.

**Fix**: new format embeds `N`/`r`/`p` directly (`scrypt$N$r$p$salt$hash`,
PHC-shaped though not that literal spec), decoded and used per-hash by
`verifyPassword()` - a future cost increase only changes new hashes;
every previously-issued one keeps verifying under its own original
parameters forever, no forced migration. Safe to land now specifically
*because* no real account exists yet in any deployment - this was
called out as the one moment to do this for free. `lib/auth.ts`'s
`DUMMY_PASSWORD_HASH` (the fixed-cost decoy that closes a real,
previously-measured timing side-channel for account enumeration) is now
imported from `lib/password.ts` instead of hand-duplicated - a
hand-written literal in the old format would have failed the new
parser's shape check and returned `false` *before* running scrypt at
all, silently reopening the exact timing gap this constant exists to
close. Verified directly: hash/verify round-trip correct; a legacy
`salt:hash` string safely rejected (no throw); a hash produced under
different (lower) cost parameters still verifies correctly against its
own embedded values; `DUMMY_PASSWORD_HASH` still measured at ~394ms
(real scrypt cost, not a fast-path bypass).

### M-3 (fixed): no ceiling on total attempts against one account distributed across many IPs

The per-account bucket is keyed by identifier+IP together (a deliberate
H1 fix earlier this session, closing cross-tenant lockout) - but as a
direct consequence, an attacker rotating source IPs gets a fresh
5-attempt allowance against the *same* account from every new IP, with
no limit anywhere on the total.

**Fix**: new third bucket, `getAccountOnlyKey()` (IP-independent,
hashed identifier only), 50 attempts/15min - deliberately generous,
sized to never fire on a real user occasionally mistyping their
password from a few different networks/devices, while still bounding a
genuinely distributed attacker. Verified against a real server: 50
wrong-password attempts against one account, each from a distinct
spoofed source IP (`X-Forwarded-For`, `TRUSTED_PROXY_COUNT=1`), all
allowed (`401`s, not `429`s, since each individual IP's own bucket
stays under its own threshold); the 51st, yet another new IP, correctly
returns `429`; a subsequent *correct*-password attempt is also blocked
(the account-global bucket doesn't distinguish right from wrong
passwords, by design - the same tradeoff the per-account+IP bucket
already accepted); an unrelated account from a fresh IP is unaffected.

### M-4 (documented, no code change): rate-limiter state resets to empty on every redeploy

Confirmed, accepted tradeoff, not an oversight - the audit's own
finding explicitly offers "document explicitly" as sufficient for a
single-replica, low-traffic deployment where redeploys are operator-
triggered, not something an external attacker can invoke on demand.
Considered and deliberately not moved to SQLite-backed persistence:
this file sits on the hot path of every auth request, and durably
persisting `checkAndReserveAttempt()`'s synchronous-atomicity guarantee
(the exact property that closed the concurrency race in an earlier
round) is real structural surgery to a security-critical path, not a
targeted fix - not something to take on hastily right before a
production launch. §116/M-3's new account-global bucket also narrows
the practical impact of a reset somewhat, since it's the one bucket an
attacker needs the most requests to rebuild. Documented directly in
`lib/login-rate-limit.ts`'s own header comment.

### Low findings fixed

- **`/api/forgot-password` had no `Origin` check (fixed)**: confirmed
  live - a cross-origin POST with a spoofed `Origin` still returned the
  real `200` success response and sent the real reset email. Unlike
  login/signup there's no session to steal here, but a malicious page
  could still burn a victim's own IP rate-limit bucket and mail-bomb
  arbitrary addresses through visitors' browsers. Added the same
  `isSameOrigin()` gate login/signup already use, in the same first-line
  position. Verified: cross-origin now `403`, same-origin unaffected.
- **`/api/logout` and `/api/verify-email/resend` relied solely on
  `SameSite=Lax` (fixed)**: `SameSite=Lax` treats sibling subdomains as
  same-site, so either route becomes forgeable if anything on a sibling
  of this console's domain is ever attacker-influenced - a forced logout
  is the more consequential of the two (revokes *every* session for the
  account under `MULTI_TENANT`, not just the one device). Same
  `isSameOrigin()` gate added to both, one line each. Verified: both
  routes now `403` cross-origin; `verify-email/resend`'s rejection fires
  *before* its own session check, confirmed by testing with no session
  cookie at all and still getting the origin-check's `403`, not the
  auth check's `401`.

### Remaining Low/Informational findings triaged (documented, no code change)

- **Server Actions accept unvalidated, untyped input**: TypeScript types
  are erased at runtime, so an authenticated client technically controls
  every field passed to e.g. `issueLicenseAction`. The audit's own
  framing already calls this "probably fine given the backend is out of
  scope" - the license server validates its own schema independently -
  and a `zod`-style parse at the boundary is real defense-in-depth, not
  a closure of a confirmed exploit. Not implemented this round; a real
  candidate for a dedicated pass, not a one-line addition alongside
  everything else here.
- **`X-Forwarded-For` trust is deployment-topology-dependent**: already
  correctly configured for the documented topology (`expose:` not
  `ports:`, Traefik as the sole path in, `TRUSTED_PROXY_COUNT=1`) -
  confirmed safe today, fragile only if that topology ever changes.
  Nothing to fix; the audit itself frames this as "flagging because the
  safety depends on a deployment property, not this code."
- **Healthcheck (`/login`) passes on a deploy missing `SESSION_SECRET`/
  `PUBLIC_BASE_URL`/`EMAIL_PROVIDER`**: partially addressed as a side
  effect of H-1's new `instrumentation.ts` boot hook (a deploy missing
  `MULTI_TENANT` correctly against real data now fails to boot at all,
  healthcheck moot), but that hook only calls `getDb()` - it does not
  validate `SESSION_SECRET` or the other secrets this finding is
  actually about, since those are checked lazily, only when a session
  token is first created/verified. Genuine residual gap, not silently
  closed by H-1: a real comprehensive boot-time env-validation pass
  (checking every required secret, not just the `MULTI_TENANT` case) is
  the real fix, and is a distinct, larger piece of work from everything
  else in this round - recorded here so it isn't mistaken for done.
- **`/api/health/db` has no `Cache-Control`**: hygiene only per the
  audit's own framing - non-sensitive content, and the route is already
  session-gated (confirmed: unauthenticated request 307s to `/login`
  before this route ever runs). Not fixed this round.

`npx tsc --noEmit`, `npx eslint .`, and `npm run build` all clean after
every fix in this section.

## 54. Beta-readiness product gap analysis - top 5 fixed (2026-08-06)

Operator: "one last thing before we deploy this beta... excluding actual
payments, what functionality are we missing that is of high or critical
importance... put your product management hat on and be critical," with
explicit permission to engage Opus if useful. Two Opus agents ran in
parallel - one reading this repo's actual code for console self-service
completeness, one reading `casazium/license`'s API completeness and
operational readiness (see that repo's PROJECT_STATUS.md §65) -
synthesized into a single prioritized CRITICAL/HIGH list, payments
excluded per the operator's own standing scope decision. Operator then
authorized fixing the top five findings before opening the beta.

### C1/C2 (fixed): a hosted tenant had no way to ever see their own API key or the real API base URL

Confirmed the finding directly: `app/api/signup/route.ts` encrypts
`tenant.apiKey` into `accounts.tenant_api_key_encrypted` and never
returns it to the browser; no page, action, or route in the whole repo
ever decrypted it for display (grep confirmed). The one integration
snippet the console showed (`licenses/[key]/page.tsx`) was a literal,
un-fillable `https://<your-license-server>` placeholder - unusable for
the exact audience the SaaS tier targets, since a hosted tenant has no
"your license server" to substitute. Meanwhile `saas-tier.md` and
`Pricing.tsx` both promise "sign up and get an API key."

Added a new `/settings` page (`app/(app)/settings/page.tsx` +
`ApiKeyReveal.tsx`), reachable via a new "API access" nav item shown only
under `MULTI_TENANT` (same gating pattern as the existing Billing nav
item). Shows the tenant's own key (masked by default, `PasswordInput`
reveal toggle, Mantine `CopyButton`) and `LICENSE_API_URL` (already this
console's own public Coolify Domain for the backend - safe to display
directly). Fixed the license-detail page's placeholder snippet to use the
real base URL for hosted tenants (self-hosted keeps the placeholder,
since self-hosted operators already know their own server's URL and this
console has no way to know it for them).

### C3 (fixed): no error boundary anywhere - a license-server hiccup showed Next's raw, unbranded crash page

Confirmed: `find app -name "error*"` returned nothing anywhere in the
repo, and `liveFetch` had no timeout, so a hung backend hung the whole
request indefinitely. Added `app/error.tsx` (catches
`app/(app)/layout.tsx`'s own errors, e.g. `requireSession()` failing -
Next never routes a segment's own layout errors to that segment's own
`error.tsx`, so this needs to live at the root) and
`app/(app)/error.tsx` (catches everything nested under the app shell -
pages, Server Actions). Both offer "Try again" (`reset()`) plus a link
back to `/dashboard` or `/login`. Added a 15s `AbortSignal.timeout()` to
`liveFetch` in `lib/license-client.live.ts` so a dead backend now throws
promptly into one of these boundaries instead of hanging.

### C4 (fixed): the `product_id` ownership 403 - the first error a new signup's onboarding form can hit - showed a generic, un-actionable "try again"

`casazium/license`'s `issue-license.js` already returns a specific 403
(`product_id is owned by a different tenant`) for this case (that repo's
own §64 H-1) - the gap was entirely here: nothing classified it, so it
fell through to the same generic catch-all as a real transient failure,
telling a user to retry a request that can never succeed by retrying.
Added `isProductIdTaken()` (`lib/errors.ts`), a `'product-id-taken'`
reason on `issueLicenseAction`'s result type, and `notifyProductIdTaken()`
(`lib/notify.ts`) - `IssueLicenseForm.tsx` now shows a specific message
and sets a field-level error on `product_id` pointing at the actual fix
(pick a different one).

### C1 (fixed, cross-repo): no backup mechanism for this console's own SQLite database

This console's DB is the *only* copy of every hosted tenant's encrypted
`casazium/license` API key - losing it strands every tenant's licenses
with no way back in, distinct from (and just as severe as) that repo's
own DB-loss risk (see its PROJECT_STATUS.md §65 for the full backup
writeup - same mechanism, mirrored here). Added
`scripts/backup-db.mjs` (better-sqlite3's WAL-safe online backup API,
already a runtime dependency), wired into `Dockerfile` (explicit `COPY`
- not part of the Next standalone trace since nothing in the app imports
it) and `docker-compose-coolify.yml` (new `console-backups` volume,
separate from `console-data`; `BACKUP_DIR` env var; a Coolify Scheduled
Task the operator still needs to create). `DEPLOYMENT.md` gained a
Backups section with a restore procedure.

**Rehearsed, not just written**: seeded a scratch `console.db` with a
real `accounts` row matching the actual schema, ran the backup script
against it, verified the resulting file's own `PRAGMA integrity_check`,
then re-opened it directly and confirmed the row round-tripped correctly.

### C4 (fixed, cross-repo): no Terms/Privacy acceptance anywhere in the signup flow

`SignupForm.tsx` had no terms link and no acceptance checkbox at all
(grep confirmed). Added a required `Checkbox` linking to
`casazium.com/terms` and `casazium.com/privacy` (both updated this round
- see `casazium/casazium`'s own changes) and a matching server-side check
in `app/api/signup/route.ts` (`agreedToTerms !== true` → 400) - enforced
server-side, not just client-side, since a direct POST to this route
would otherwise skip it entirely, same reasoning as every other field
this route already validates.

### C3 (fixed, cross-repo): `EMAIL_FROM` was documented as optional for a real SaaS deploy

It wasn't safe to leave unset: Resend's sandbox default only delivers to
the account owner, so every signup confirmation and password reset to an
actual customer would be silently rejected, and - since that send
failure is intentionally swallowed so signup itself doesn't hard-fail -
nobody would notice until a locked-out user (email verification gates
nothing, but password reset is the *only* account-recovery path) had no
way back in. `createResendEmailProvider()` (`lib/email/resend-provider.ts`)
now fails loud in production if `EMAIL_FROM` is unset, mirroring
`EMAIL_PROVIDER`'s own existing fail-loud posture (`lib/email/index.ts`).
`DEPLOYMENT.md` and `.env.example` corrected from "optional" to
"required."

### Verification

`npx tsc --noEmit`, `npx eslint .`, `npm run build`: all clean.
`docker compose -f docker-compose-coolify.yml config`: exit 0.
Backup/restore rehearsed directly (above). No `docker build` performed -
no Docker daemon available in this session; `Dockerfile`'s new `COPY`
source was confirmed to exist and `.dockerignore` confirmed not to
exclude `scripts/`.

## 55. Fix cross-resource Traefik routing collision during SaaS-C1 provisioning (2026-08-06)

Same root cause as `casazium/license`'s own `PROJECT_STATUS.md` §67,
found immediately after fixing that one and asked to check for the same
pattern here. Operator report: the standalone (`license.casazium.com`)
and SaaS-C1 (`license-cloud.casazium.com`) console login pages were
intermittently serving the wrong instance - not randomly, but tracking
which resource had deployed most recently, regardless of which domain
was actually requested.

`docker-compose-coolify.yml` is built verbatim by both console resources
(this file's own header comment: "a SaaS-tier deployment is a SEPARATE
Coolify resource from this same repo/compose file"). Its `labels:` block
declared a hardcoded, literal Traefik service name -
`traefik.http.services.license-console-svc.loadbalancer.server.port=3000`
- plus a matching `license-console-headers` middleware name. Both
resources' containers registered the identical service name; Traefik's
Docker provider keys its dynamic config by that label-derived name, not
by Coolify resource ID, so only one `license-console-svc` object could
exist at a time, and whichever container registered most recently
silently owned it for both domains at once.

Couldn't fix by parameterizing the label per-resource with `${VAR}` -
same constraint as the license-repo fix: Coolify doesn't interpolate
`${VAR}` inside Compose `labels:` (confirmed, see
`casazium/casazium`'s own `CLAUDE.md`), unlike `environment:` on this
exact file, where it works fine.

**Fix**: removed both labels entirely, mirroring the already-validated
fix on `casazium/license`'s own `docker-compose-coolify.yml` (commits
1226129, 08e4f66, 3f729a4) - Coolify's Domain-based routing resolves the
backend port from `expose: 3000` alone with no custom label needed.
`docker-compose-coolify.yml`'s own `labels:` block now documents this
inline so a future edit doesn't reintroduce a shared literal name.

**Verification**: unlike the license API (which has a per-resource
RSA public key to compare), this console has no equivalent
single-request signal of which backend answered. Verification is
therefore procedural, not yet a hard confirmation: the fix mirrors the
license-repo one exactly (same label mechanism, same root cause, same
Coolify Domain-based routing underneath), and `docker compose -f
docker-compose-coolify.yml config` returns exit 0. Operator still needs
to redeploy both console resources once each and confirm the flip-flop
is gone in practice (e.g. repeated refreshes of both login pages across
a couple of redeploys, watching for either page changing based on the
other's deploy order) before this can be marked fully confirmed the same
way §67 was.

## 56. Stale-branch cleanup: `saas-tier` confirmed merged; a local-clone git-config defect produced (and then disproved) a false "31 unpushed commits" alarm (2026-08-11)

Prompted by the same cross-repo branch-cleanup pass as `casazium/license`
§68 — operator asked to check every repo's stale branches, not just
`casazium/casazium`'s.

This repo carries exactly one non-`main` branch, `saas-tier`. First pass
looked alarming: `git merge-base --is-ancestor origin/saas-tier
origin/main` returned **false**, with 28 commits showing as unmerged and
a 7,221-line diff between the two — directly contradicting
`casazium/casazium`'s own `PROJECT_STATUS.md` (task `Merge saas-tier ->
main: license-console`, recorded done). Investigated rather than trusted
either record: comparing local `main` (this session's clone) against
`origin/main` showed local `main` **31 commits ahead** — including the
entire `saas-tier` merge, four rounds of security-review fixes, and the
beta-readiness pass — none of it seemingly on GitHub. Reported this to
the operator as a real risk (unpushed work, possibly never actually
landed) rather than deleting anything; operator asked to push local
`main` to `origin`.

**The push was already unnecessary — the alarm was a false one, root-
caused before concluding otherwise.** `git push origin main` reported
"Everything up-to-date"; investigating why revealed `remote.origin.fetch`
was empty in this session's local clone of this repo specifically (not
`casazium/license`, not `casazium/casazium` — confirmed by checking both,
clean) — with no fetch refspec, `git fetch` was pulling objects
successfully but silently never updating `refs/remotes/origin/main`,
leaving it frozen at whatever value the initial clone happened to set.
`git ls-remote origin main` (a direct, uncached query to GitHub) showed
`origin/main` had actually matched local `main` all along. Fixed the
refspec (`git config remote.origin.fetch
"+refs/heads/*:refs/remotes/origin/*"`), re-fetched, and confirmed: local
`main` and the real `origin/main` are identical, and — rechecked with a
now-trustworthy `origin/main` — `saas-tier` **is** fully merged, 0 unique
commits, same as every other repo. No actual gap ever existed; only this
clone's tracking ref was lying.

**Cause of the git-config defect not identified** (whether an artifact of
how this container's `add_repo`/clone tooling set this particular clone
up, or something from a prior session's manual `git remote` edit) — flagged
here in case a future session hits the same misleading symptom in this
or another repo; the fix (setting the standard fetch refspec explicitly)
is one line and safe to reapply if seen again.

Local `saas-tier` deleted with a plain `git branch -d saas-tier`
(non-force — succeeded on its own, second confirmation nothing was
unmerged). The remote copy on GitHub could not be deleted this session:
`git push origin --delete saas-tier` failed with a real `HTTP 403`
(organization egress-policy denial at the git-proxy layer, not retried,
matching the same limitation hit in `casazium/license` and previously in
`casazium/casazium`). `origin/saas-tier` still exists on GitHub; the
operator needs to delete it directly there — confirmed safe to do so by
the verification above.

## 57. Off-box backup gap: Coolify Scheduled Tasks live on both resources; `rclone` added for the B2 push (2026-08-12)

Companion to `casazium/license`'s own `PROJECT_STATUS.md` §72 — same
gap, same fix, same session. `casazium/license`'s `SUPERADMIN_REPORTING_DESIGN.md`
§10 named the off-box backup gap for both repos' production databases as
still-open and independent from the reporting design; this is that work
starting.

**Local, on-schedule backups now confirmed running.** `scripts/backup-db.mjs`
already existed and worked (built for `BETA-2`) but had no Scheduled Task
triggering it - operator created one (`node scripts/backup-db.mjs`,
daily) on both resources this repo runs (standalone and SaaS-tier) and
confirmed each ran cleanly (integrity check passed, per the actual
task-execution log).

**Off-box push, mechanism only so far.** Same B2 setup as
`casazium/license`: one shared bucket (`licenseServer`), one Application
Key scoped only to backup-push permissions
(`blazeKeyID`/`blazeLicenseServerAppKey`, server-wide Coolify variables
covering both repos' resources on both hosts) - operator's deliberate
choice of one shared credential over per-service ones, judged an
acceptable simpler tradeoff given the bounded blast radius of a leaked
backup-push-only key. Added `rclone` to the runtime image (`Dockerfile`)
so the push runs from inside the same container the Scheduled Task
already executes in. **Could not verify the `apk add` install via a real
build** - no Docker daemon available in this session, and this session's
own network policy blocked a direct check against Alpine's package
mirror - relying on `rclone` being a long-standing, ordinarily-available
Alpine community package rather than a verified build; confirm via the
actual Coolify build log on redeploy.

**Not yet done**: the Scheduled Task commands on both resources still
need updating to actually invoke `rclone` after the backup step, once
this Dockerfile change is deployed and confirmed to build cleanly.

## 58. Off-box backup gap closed end to end - real pushes confirmed, plus three real bugs found and fixed along the way (2026-08-12)

Companion to `casazium/license`'s own §73, same session, same three
bugs found and fixed - full reasoning lives there, summarized here.

**A costly misdiagnosis, corrected.** Three different command
formulations (plain `&&`, `sh -c "..."`, and finally a real script file,
added specifically to rule out a suspected Coolify command-parsing bug)
all showed only the backup script's own output, no trace of `rclone`.
The actual cause, found only by checking the B2 bucket directly instead
of continuing to trust the Coolify task log: `rclone copy` prints
nothing on a clean, successful run - every prior sighting of its output
had come from *failed* attempts. The original plain `&&` command had
been working the whole time. `scripts/backup-and-push.sh` was kept
anyway (a cleaner pattern regardless), its header comment corrected to
record what actually happened.

**Bug found: standalone and SaaS-tier backups were indistinguishable.**
Fixed by branching the remote path on `MULTI_TENANT`
(`licenseServer/console/saas/` vs. `.../standalone/`) - reuses a
variable already set correctly and differently on both resources.

**Bug found: no retention on the remote side.** A single afternoon of
manual debugging runs alone produced 6 snapshots in the bucket with no
cleanup path. Fixed with `rclone delete --min-age`, reusing the same
`BACKUP_RETENTION_DAYS` variable (default 14) `backup-db.mjs`'s local
pruning already reads, run after the push so an interrupted run never
leaves the remote with zero backups.

**Bug found while investigating the above: local pruning had its own
gap.** `backup-db.mjs`'s prune regex only matched the bare `.db`
extension, leaving `-shm`/`-wal` sidecar files behind forever once their
`.db` aged out and was deleted. Fixed by widening the pattern, pruned
independently by each sidecar's own mtime.

**Operational note, confirmed directly:** `rclone copy` syncs the
*entire* local `/app/backups` folder against the remote on every run,
not just the newest file - confirmed when a manual bucket-wide delete
(via Backblaze's web UI, testing the new retention step) was
immediately undone by the next single task run, correctly re-uploading
every local file still present. A genuinely useful self-healing
property, not a bug.

## 59. Restore drill: `scripts/restore-drill.mjs` + `restore-drill-from-b2.sh` - the backup pipeline had never actually been used to restore anything (2026-08-12)

Companion to `casazium/license`'s own §74, same session, same rationale:
§57/§58 closed the off-box push gap, but a backup that has never been
restored is unverified, not merely untested. `restore-drill.mjs` closes
it - safe to run against a real production B2 backup on the live host,
since it only ever operates on a throwaway scratch copy (`os.tmpdir()`)
and never touches `DB_FILE` or the live database.

Three checks:

1. **`PRAGMA integrity_check` on the transferred copy** - catches
   corruption introduced by local storage + the rclone/B2 round trip,
   independent of `backup-db.mjs`'s own check at capture time.
2. **Row counts across every real table** - a schema-only or stale
   backup passes `integrity_check` but fails this.
3. **Re-applying `lib/db/schema.sql`, then the same `MULTI_TENANT`
   fail-loud guard `lib/db.ts`'s `openDatabase()` runs on every real
   connection open** (refuses to proceed if `MULTI_TENANT` isn't `'true'`
   but `accounts` already has rows) - the check that matters most, since
   it's the exact gate that would otherwise only be exercised for real
   during a live incident: restoring a SaaS-tier backup onto a
   standalone-configured resource.

**Design decision: reimplements `lib/db.ts`'s `openDatabase()` logic
rather than importing it** - same choice `backup-db.mjs` already made
for the same reason, this session: `lib/db.ts` is TypeScript, and this
repo has no `tsx`/`ts-node` devDependency to run it standalone. Its
actual logic (schema exec + the `MULTI_TENANT` guard) is short enough to
reproduce directly rather than add a new toolchain dependency just for
one script. Kept in sync by hand - any future change to `openDatabase()`
needs updating here too. `casazium/license`'s matching script makes the
same reimplementation choice, for a related but distinct reason (its
Dockerfile deliberately ships only an obfuscated bundle, not `src/`).

**A real bug found and fixed while writing this script, before it ever
shipped:** the first draft copied `backup-db.mjs`'s own `ROOT_DIR`
pattern (`path.dirname(fileURLToPath(new URL('.', import.meta.url)))`)
to locate `lib/db/schema.sql` relative to the script. `path.dirname()`
on a *directory* URL (trailing slash) strips one extra path segment -
confirmed directly (`path.dirname('/app/scripts/')` returns `/app`, not
`/app/scripts`) - so `ROOT_DIR` silently resolved one level too high,
and the schema read failed with `ENOENT` on first real run against a
synthetic test database. Fixed by computing `SCRIPTS_DIR` as
`path.dirname(fileURLToPath(import.meta.url))` (dirname of the *file*
path itself) instead. Caught by actually running the script against a
locally-built test database before shipping it, not by inspection -
`backup-db.mjs`'s own copy of this same pattern is unaffected only
because its default `BACKUP_DIR` (`path.join(ROOT_DIR, '../backups')`)
is never exercised in production (`BACKUP_DIR` is always set explicitly
by the Coolify Scheduled Task), so the same one-level-off bug has been
silently latent there this whole time. Not fixed in `backup-db.mjs`
itself this session (out of scope, never actually triggered) - worth a
follow-up if that script's default path is ever relied on.

**`restore-drill-from-b2.sh`** wraps it the same way `backup-and-push.sh`
wraps `backup-db.mjs` - same `MULTI_TENANT`-branched remote path, same
latest-`.db`-by-lexicographic-sort selection (filenames are ISO-8601
timestamped), same scratch-dir-and-cleanup pattern. Safe to run as its
own Coolify Scheduled Task on the same schedule/container as
`backup-and-push.sh`.

**Verification performed this session (local, not yet run against a
real production B2 backup):** built a synthetic `console.db` locally via
`lib/db/schema.sql`, ran `restore-drill.mjs` against it - passed all
three checks. Separately confirmed the fail path: inserted a real
`accounts` row into a second synthetic DB, ran the drill with
`MULTI_TENANT` unset - correctly threw and exited 1 rather than starting
silently. Not yet run against an actual B2-fetched production backup on
the VPS - that's the next step to fully close this gap, same posture
§57 was in before §58's real-bucket verification.

Both new scripts wired into the Dockerfile the same way
`backup-and-push.sh` was (`COPY` + `chmod +x`, before `USER node`) - the
schema-copy dependency on `scripts/copy-standalone-assets.mjs`'s
postbuild step (which places `lib/db/schema.sql` into
`.next/standalone/lib/db/`) is noted inline in both the script's header
and the Dockerfile comment.

## 60. docker-compose-coolify.yml audited (no gap found); real self-hosted console deployed against the new SLS backend, one live auth mismatch found and fixed (2026-08-15)

Companion session to `casazium/license`'s own PROJECT_STATUS.md §122/
§123 - operator had just fixed a real `docker-compose-coolify.yml` gap
in that repo (missing `build.args:`/`environment:` entries broke a
Tier-B/SLS deployment) and asked for the same audit here.

**Audit found no equivalent gap.** Unlike `casazium/license`'s
Dockerfile, this repo's `Dockerfile` declares no build ARGs at all
(only `ENV NODE_ENV=production`/`ENV HOSTNAME=0.0.0.0`, both baked) -
structurally, there's no operator-configurable build-time switch here,
so the specific "build arg never forwarded" bug class that hit
`casazium/license` can't occur in this repo. Every real
`process.env.*` read across the whole codebase (not just
`lib/config.ts`) was grepped and cross-checked against
`docker-compose-coolify.yml`'s `environment:` list: all 18 operator-
configurable runtime vars present and correctly placed; `DB_FILE`/
`HOSTNAME`/`BACKUP_DIR` correctly present as literals matching the
image's `WORKDIR`/volume mounts; `NODE_ENV` correctly absent (baked
into the image); `APP_VERSION`/`GIT_SHA` correctly absent (computed at
build time in `next.config.mjs`, not real env vars); `BACKUP_RETENTION_DAYS`
correctly absent (optional, has a working default); `NEXT_RUNTIME`
correctly absent (Next.js-internal). Confirmed with `docker compose
config` - valid YAML, every `${VAR}` resolves correctly. Nothing
changed in this repo as a result - a real, verified "already correct"
finding, not just an absence of complaints.

**A real self-hosted console resource was then configured end to end**
against `casazium/license`'s new SLS/Tier-B backend (that repo's
PROJECT_STATUS.md §123), walked through variable-by-variable: `MULTI_TENANT`/
`ACCOUNT_ENCRYPTION_KEY`/`EMAIL_PROVIDER`/`RESEND_API_KEY`/`EMAIL_FROM`
all correctly left blank for self-hosted mode (confirmed against
`lib/email/index.ts`'s exact fail-loud gate -
`NODE_ENV === 'production' && isMultiTenant() && !rawProvider` - which
self-hosted mode never trips); `LICENSE_STANDALONE_MODE` left blank
(live backend, not demo mode); `LICENSE_API_URL` initially
miscommunicated as the wrong resource (`mls.casazium.com`, Casazium's
internal master resource) before being corrected to the actual SLS
resource's own domain (`sls.casazium.com`) - a real, easy-to-make
mix-up given both MLS and SLS run the identical codebase, just as
different Coolify resources with different jobs.

**A real live bug found and fixed during first boot:** the console's
dashboard threw `LicenseApiError: Unauthorized` (`status: 403`) on
`getRecentlyIssuedLicenses`/`getRecentActivations`. Traced the exact
error text back to `casazium/license`'s `src/hooks/require-admin.js`,
which returns precisely `403 { error: 'Unauthorized' }` on any
`ADMIN_API_KEY` mismatch - confirming the request reached the SLS
backend fine (not a `LICENSE_API_URL`/routing/CORS problem) and the
failure was `LICENSE_ADMIN_API_KEY` not matching that resource's own
`ADMIN_API_KEY`. Also checked, before handing back a diagnosis: this
repo's `resolveApiKey()` trims `LICENSE_ADMIN_API_KEY` before sending
it, but `require-admin.js` does *not* trim `process.env.ADMIN_API_KEY`
before comparing - a real asymmetry that could make an accidental
trailing newline in the SLS resource's own Coolify variable
unmatchable no matter how carefully the console's side is copied.
Operator resolved it directly; exact root cause on their end not
reported back, only confirmed fixed.

Documentation-only in this repo (no code or compose file changed - the
audit found nothing to fix). Full detail of the `casazium/license`-side
work this depended on lives in that repo's own PROJECT_STATUS.md
§116-§123.

## 61. SelfLicenseIndicator - a beta-testing visibility badge for casazium/license's self-license call-home status (2026-08-15)

Continuation of the same session. Operator's beta-testing idea: an
indicator on "the login page" showing whether the connected
`casazium/license` backend's self-license has "been verified lately."
Sketched first, since "the login page" specifically meant
pre-authentication visibility - flagged that as a minor information
leak (a coarse subscription-status signal visible to anyone who
reaches the URL, logged in or not) and proposed the post-login
dashboard instead, matching where `BETA-1`'s tenant-API-key surface
already lives. Built on confirmation.

**New types** (`lib/license-types.ts`): `SelfLicenseOutcome`/
`SelfLicenseStatus`, mirroring `casazium/license`'s
`GET /v1/self-license/status` response shape exactly (that repo's own
PROJECT_STATUS.md §125).

**New client function, all three layers** (mode dispatcher pattern,
same as every other export): `license-client.mock.ts` returns a fixed
`{tier: 'tier-a'}` (standalone/demo mode never runs against a real
backend, so there's no real Tier-A/B distinction - keeps the indicator
correctly hidden in demo mode); `license-client.live.ts` does a real
`GET /self-license/status` through the existing `liveFetch()`/
`resolveApiKey()` machinery, no new auth path; `license-client.ts`
re-exports through `client()` like every other function.

**New component**, `components/SelfLicenseIndicator.tsx` - an async
Server Component, fetched independently of the dashboard's own
`Promise.all` batch (`app/(app)/dashboard/page.tsx`) specifically so a
failure to reach this one endpoint can never take down the rest of the
dashboard (a bare `try/catch` around the fetch, returns `null` on any
error) - same fail-soft posture as the backend mechanism it displays.
Renders nothing for `tier: 'tier-a'` (the common case, matching
`MockDataNotice`'s own "decide my own visibility" pattern), a neutral
badge before the first call-home attempt resolves, green with the
verified timestamp + expiry on success, red with the timestamp + error
text on failure. Uses `lib/format.ts`'s existing `formatDateTime()`
(fixed UTC, not relative time) rather than inventing a new time
format - this codebase already deliberately avoids relative-time
strings for hydration-safety/cross-page-consistency reasons documented
in that file's own header comment.

**Verified for real, not just type-checked.** `npm run lint` and
`npm run build` (a real `next build`, full TypeScript + route
generation) both clean. Then two live smoke tests, both against real
running processes, not simulated:

1. **Mock mode**: booted the dev server with no `LICENSE_API_URL`/
   `LICENSE_ADMIN_API_KEY` set, logged in for real (`POST /api/login`
   with a real session cookie), fetched `/dashboard` - `200`, no
   "self-license" text anywhere in the rendered HTML, confirming the
   indicator correctly renders `null` in demo mode.
2. **Live mode, cross-repo**: booted a real `casazium/license` backend
   (`node src/app.js`, real generated secrets, no compiled self-license
   module) alongside this console pointed at it via real
   `LICENSE_API_URL`/`LICENSE_ADMIN_API_KEY`, confirmed
   `GET /v1/self-license/status` directly (`{"tier":"tier-a"}`, `200`),
   then logged into the console for real and fetched `/dashboard` -
   `200`, still no visible badge (correct - `tier-a`), and confirmed via
   the *backend's own request logs* that two real `GET /v1/self-license/
   status` calls actually arrived and both returned genuine `200`s, not
   a silently-swallowed error masquerading as "nothing to show."

Both smoke-test processes and their scratch DB/env files were killed
and deleted afterward - nothing left running, no stray files.

## 62. SelfLicenseIndicator's 'restored' outcome - closing the same blind spot found in casazium/license's own §126 (2026-08-15)

Continuation of the same session, same day as §61. Operator asked
whether a redeploy of the real SLS instance would show "pending first
check-in" on the new badge. `casazium/license`'s own investigation
(that repo's PROJECT_STATUS.md §126) found a real gap: a redeploy
landing inside the backend's 14-day credential validity window
restores a still-valid cached credential and skips a fresh call-home
entirely, leaving `lastOutcome` `null` - indistinguishable from a
genuinely fresh Tier-B build that had never checked in, even though
the mechanism is actually healthy. That repo added a new `'restored'`
outcome to close it; this is the console-side half.

**`lib/license-types.ts`**: `SelfLicenseOutcome['outcome']` gained
`'restored'`, with a comment explaining why it's meaningfully
different from both `'success'` and a null `lastOutcome` - and why it
never carries `expiresAt` (the backend has no way to know the restored
credential's real expiry, see that repo's own `recordOutcome()` call
site).

**`components/SelfLicenseIndicator.tsx`**: new branch, a blue badge
reading "Self-license: using cached credential", labeled "confirmed
still valid as of `<time>`" - deliberately not claiming to know when
the credential was originally verified, only that this boot confirmed
it's still trusted. Placed between the `'success'` branch and the
catch-all failure/misconfigured/load-error branch.

`npm run lint`/`npm run build` both clean (no dedicated test suite in
this repo, per the SaaS-B2-era convention documented elsewhere in this
file - `npm run build`'s real TypeScript pass across the whole app is
the verification layer here).

