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
tenant — there's no standalone/mock equivalent). Password-reset and
signup-confirmation email are both built (`lib/email/`) — see
[Local SaaS-tier testing](#local-saas-tier-testing) below for how to try
them.

Under `MULTI_TENANT=true`, the `BRANDING_*` vars become the *platform*
default (`SaaS-B3`) — shown pre-auth and to any tenant without its own
override in `tenant_branding`. No settings UI writes that table yet; only
the DB-driven resolution itself is built.

## Local SaaS-tier testing

Standalone mode (above) can't exercise `MULTI_TENANT=true` — signup
provisions a real tenant, so it needs a real `casazium/license` server
running alongside this console, not the in-memory mock. Nothing in
either repo's own docs previously walked through that combination as
one path; this does.

**1. Start a real `casazium/license` server**, in a sibling checkout of
that repo:

```bash
cd ../license
npm install
node scripts/generate-env-production.js   # prompts for a port, Enter for default 3001
mv .env.production .env                   # docker-compose reads .env, not .env.production
echo "MULTI_TENANT=true" >> .env
npm run dev
```

Confirm it's up: `curl http://localhost:3001/` should return
`{"message":"License API is running",...}`. Keep this running — you'll
need the `ADMIN_API_KEY` value from its `.env` next.

**2. Point this console at it.** Back in this repo:

```bash
cat > .env.local <<EOF
DB_FILE=./data/console.db
SESSION_SECRET=$(openssl rand -base64 32)
MULTI_TENANT=true
ACCOUNT_ENCRYPTION_KEY=$(openssl rand -hex 32)
LICENSE_API_URL=http://localhost:3001/v1
LICENSE_ADMIN_API_KEY=<paste ADMIN_API_KEY from license/.env>
EOF
npm run dev
```

**3. Optional: real email instead of stub logging.** By default
(`EMAIL_PROVIDER` unset), signup-confirmation and password-reset links
are logged to this console's own terminal output (`[stub-email] ...`),
not sent anywhere — fine for exercising the flows without a real
inbox. To actually receive them, add to `.env.local`:

```
EMAIL_PROVIDER=resend
RESEND_API_KEY=<a real Resend API key>
```

Leave `EMAIL_FROM` unset — Resend's own `onboarding@resend.dev` default
sender only delivers to *your Resend account's own verified email
address*, which is exactly what you want for testing (no domain
verification needed). Sign up using that same address to actually
receive the email.

**4. Try it**: `/signup` provisions a real tenant and lands you on
onboarding. `/billing` → select a plan → in-app demo checkout (no real
payment). A "verify your email" banner appears until the confirmation
link is clicked. Sign out, then "Forgot password?" on the login page
exercises the reset flow the same way.

**Resetting to a clean slate**: stop both servers, `rm -rf data/` in
each repo (keep `.env`/`.env.local` — just the data), restart both
(license first). Both recreate their own database automatically.

## Deployment

See [`DEPLOYMENT.md`](DEPLOYMENT.md) for the Coolify runbook, including
both the self-hosted and SaaS-tier (multi-tenant) deployment paths and
how the two coordinate with `casazium/license`'s own deployment.
