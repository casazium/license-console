# Deploying to Coolify

This is the production deployment path for this service. `docker-compose-coolify.yml` is purpose-built for a Coolify-managed deployment — there is no plain `docker-compose.yml` in this repo for local/dev use; `npm run dev` covers that (see the README's Development section).

This console runs in one of two entirely different modes, controlled by `MULTI_TENANT`. Read the "Which mode do I want?" section below before starting — the two are genuinely separate deployments (separate Coolify resources even, if you ever run both), not a single setup with an optional flag.

## Which mode do I want?

**Self-hosted** (`MULTI_TENANT` unset — the default): one operator, one static login pair (`ADMIN_UI_USERNAME`/`ADMIN_UI_PASSWORD`), managing one `casazium/license` server. This is almost certainly what you want if you're deploying this alongside your own self-hosted `casazium/license` instance.

**SaaS** (`MULTI_TENANT=true`): real per-tenant signup/login against this console's own database, billing/quota UI, the works — the hosted multi-tenant product. This must point at a `casazium/license` server that is *also* running `MULTI_TENANT=true` (see that repo's own `DEPLOYMENT.md`, "Deploying the SaaS-tier instance") — pairing this mode with a self-hosted server, or vice versa, doesn't work: that server's admin key is never a valid credential on the tenant-scoped routes this console needs once `MULTI_TENANT=true` (confirmed directly during `SaaS-B2`'s own testing — this exact mismatch produces a `500`, not a clear error).

The rest of this doc covers self-hosted first (steps 1-5), then what's additionally needed for SaaS mode.

## 1. Create the resource

In Coolify: **New Resource → Docker Compose**, pointing at this GitHub repo. Set the **Compose file path** to `docker-compose-coolify.yml`.

## 2. Set environment variables

In Coolify's environment variables UI for this service (never committed to the repo):

| Variable | Notes |
|---|---|
| `SESSION_SECRET` | HMAC key for signed session cookies. Generate: `openssl rand -base64 32` |
| `ADMIN_UI_USERNAME` | Self-hosted login username |
| `ADMIN_UI_PASSWORD` | Self-hosted login password |
| `PUBLIC_BASE_URL` | This service's own real Domain (below), e.g. `https://console.example.com`, no trailing slash. Every emailed link (signup confirmation, password reset) and email-triggered redirect is built from this — leaving it unset fails loudly at request time in production rather than silently emailing links to this container's own unreachable internal address (security review finding H2). |

For a *live* deployment (connected to a real `casazium/license` server, which is almost always what you want), also set:

| Variable | Notes |
|---|---|
| `LICENSE_API_URL` | That server's own Coolify Domain, including `/v1` (e.g. `https://license-api.example.com/v1`) |
| `LICENSE_ADMIN_API_KEY` | Must match that server's own `ADMIN_API_KEY` exactly |

For a standalone/demo deployment instead (no real backend, seeded mock data — for evaluating look and feel), leave both of those unset **and** set `LICENSE_STANDALONE_MODE=true` to confirm that's intentional. In production, both-unset without that flag is treated as a misconfiguration rather than a silent fallback to demo data (`lib/license-client.ts`'s `getBackendMode()`) — an operator who meant to configure a real backend but didn't fails loudly instead of unknowingly running a public demo.

`BRANDING_*` vars are all optional either way — see `.env.example` for the full list and what each one does. Two of them (`BRANDING_TITLE_HTML`, `BRANDING_COLOR`) need Coolify's per-variable "Is Literal" checkbox enabled, or Coolify reprocesses the value before injecting it (confirmed — this corrupts both; see `.env.example`'s own note on the quoting angle of that failure mode).

`DB_FILE` and `HOSTNAME` are already set in the compose file itself — don't set them in Coolify.

## 3. Configure the domain

Set this service's **Domain** in the Coolify UI. Don't hand-author a Traefik router — the compose file only declares `expose: 3000` and a bare `loadbalancer.server.port` label specifically so Coolify's own routing/TLS layer owns this entirely.

## 4. Persistent storage — only matters once you turn on SaaS mode below

The compose file defines a `console-data` named volume mounted at `/app/data`. In self-hosted mode this is present but unused — every real code path that touches this console's own SQLite database (`lib/db.ts`) is gated behind `MULTI_TENANT`, so a self-hosted deployment never actually creates the DB file during normal operation. Nothing to confirm here yet; revisit this step when you enable SaaS mode.

## 5. Deploy and verify

Coolify builds from the repo's `Dockerfile` (multi-stage: builds the Next.js standalone output, then runs it in a slim, non-root Alpine runtime image) and routes traffic to port 3000 through the Domain you configured.

The compose file defines a healthcheck (a plain `GET /login`, expecting `200`) — Coolify's UI will show the service as healthy once that starts passing.

Once it's up, confirm it's actually serving: visit the Domain in a browser and confirm the login page renders with your configured branding (if any), then sign in with `ADMIN_UI_USERNAME`/`ADMIN_UI_PASSWORD` and confirm the dashboard loads. If connected to a real backend, issue a test license through the UI and confirm it appears in the licenses list.

## Deploying the SaaS-tier instance (SaaS-C1)

Everything above still applies, plus:

1. **Deploy `casazium/license`'s own SaaS-tier instance first** (that repo's `DEPLOYMENT.md`, "Deploying the SaaS-tier instance") — this console's signup flow calls that server's `POST /admin/tenants` at request time, so it needs to already exist and be reachable.
2. **Point `LICENSE_API_URL`/`LICENSE_ADMIN_API_KEY` at that SaaS-tier server specifically** — not your self-hosted one, if you're also running one. These two must be a matched pair from the *same* server resource; mixing them (this console's SaaS instance pointed at a self-hosted server, or vice versa) produces confusing `500`s rather than a clear error, as noted above.
3. **Set `MULTI_TENANT=true`.**
4. **Set `ACCOUNT_ENCRYPTION_KEY`** — 32 bytes, hex-encoded (64 hex characters). Generate: `openssl rand -hex 32`. This is a **different value** from `casazium/license`'s own `ENCRYPTION_KEY` — do not reuse it; these are two independently deployable services and sharing a key would be an unintended cross-service credential coupling, not a simplification (see `.env.example`'s own note on this).
5. **Now confirm persistent storage matters**: revisit step 4 above. Once `MULTI_TENANT=true`, this console's own SQLite database (accounts, sessions) is real and load-bearing — after the first deploy, check Coolify's storage tab and confirm the `console-data` volume is recognized as persistent for this service, not discarded on redeploy.
6. **Set `EMAIL_PROVIDER=resend` plus `RESEND_API_KEY`** (fresh pre-deployment audit finding — this step was previously undocumented here, only mentioned in the README's local-testing section). Signup confirmation and password reset are real, load-bearing flows in SaaS mode, not cosmetic ones — leaving `EMAIL_PROVIDER` unset doesn't just look wrong, it fails loud now (`getEmailProvider()` throws in production multi-tenant mode if this is unset, mirroring `LICENSE_STANDALONE_MODE`'s own explicit-opt-in pattern), specifically because the alternative used to be worse: the stub provider silently "succeeding" while logging the real reset/confirmation link in plaintext to this container's own logs. Optional: `EMAIL_FROM` (defaults to Resend's own sandbox address).

### Verify SaaS mode is actually on

```bash
curl https://<this-service's-domain>/signup
```

Should return the signup page (`200`), not a `404` — a `404` here means `MULTI_TENANT` didn't actually reach the container. Check it was saved in Coolify's UI and the service was redeployed (not just restarted) after adding it, since Coolify's compose interpolation happens at build/deploy time. (Confirm the compose file's `environment:` block includes both `MULTI_TENANT=${MULTI_TENANT}` and `ACCOUNT_ENCRYPTION_KEY=${ACCOUNT_ENCRYPTION_KEY}` if you're troubleshooting an older checkout — both were added while preparing this doc, alongside the equivalent `MULTI_TENANT` fix in `casazium/license`'s own compose file.)

For a fuller check, sign up a real test tenant through the UI (this calls the real `casazium/license` server and provisions a real tenant there — see that repo's own smoke-test section for how to revoke it afterward) and confirm you land on the onboarding flow, then issue a test license and confirm it appears. Restart the service once from Coolify afterward and confirm the account is still there (log in again) — this confirms the persistent volume from the SaaS section's step 5 is actually wired up, not just present.
