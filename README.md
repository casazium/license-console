# license-console

Admin console UI for `casazium/license`. See `PROJECT_STATUS.md` for
architecture decisions and scope, and `CLAUDE.md` for session conventions.

## Development

```bash
cp .env.example .env.local
npm install
npm run dev
```

`SESSION_SECRET`, `ADMIN_UI_USERNAME`, and `ADMIN_UI_PASSWORD` are required to
sign in locally.

`LICENSE_API_URL` / `LICENSE_ADMIN_API_KEY` connect the console to a real
`casazium/license` server (both must be set together). Leave both unset for
standalone mode — an in-memory mock with seeded demo data, the default in
`npm run dev` with no `.env` at all. In production, standalone mode also
requires `LICENSE_STANDALONE_MODE=true`, so an operator who meant to
configure live mode but left it unset fails loudly instead of silently
serving mock data. See `.env.example` for the full rationale on each var,
and `PROJECT_STATUS.md` for architecture decisions.

`DB_FILE` (optional, defaults to `./data/console.db`) is this console's own
SQLite database (`lib/db.ts`, `SaaS-B1a`) — separate from and unrelated to
`casazium/license`'s own database. It stores this console's human login
accounts and sessions, not license/tenant data.

`MULTI_TENANT` (optional, defaults to false) switches the console between
two entirely different login models (`SaaS-B1b`): self-hosted (the default)
uses the single `ADMIN_UI_USERNAME`/`ADMIN_UI_PASSWORD` pair above; SaaS
mode uses real per-account signup/login against the `accounts` table
instead, and requires `ACCOUNT_ENCRYPTION_KEY` plus a live
`LICENSE_API_URL`/`LICENSE_ADMIN_API_KEY` backend (signup provisions a real
tenant — there's no standalone/mock equivalent). Password-reset is not yet
built — blocked on choosing an email provider, deliberately deferred rather
than guessed at.

Under `MULTI_TENANT=true`, the `BRANDING_*` vars become the *platform*
default (`SaaS-B3`) — shown pre-auth and to any tenant without its own
override in `tenant_branding`. No settings UI writes that table yet; only
the DB-driven resolution itself is built.
