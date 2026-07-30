# PROJECT_STATUS.md — license-console

Status: Draft
Last updated: 2026-07-30

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

- `lib/auth.ts` — `verifyCredentials(username, password) → Identity | null`.
  Today: compares against an `ADMIN_UI_PASSWORD` env var, returns a fixed
  `{ id: 'admin', role: 'admin' }`. Later: swap the internals to check a real
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
- Multi-account login (backend work, see §3 — UI is already designed not to
  block on this).

## 6. Sanity check (2026-07-30)

Walked the full indie-developer trial loop against MVP scope: deploy own
instance → log in → issue a license → activate it from their real app via the
SDK → confirm activation shows up in console → test revoke → see it on
dashboard. Confirmed complete with no missing capability; the only gap found
was the missing activation code snippet, now folded into MVP (see table above).

## 7. Next authorized step

Scaffold the Next.js + Mantine skeleton against the MVP scope above. Not yet
started — repo currently contains only this document.
