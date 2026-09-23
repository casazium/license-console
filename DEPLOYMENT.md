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

`ENVIRONMENT_LABEL` is also optional, and not a `BRANDING_*` var: it renders a persistent red banner across every page (`components/EnvironmentBanner.tsx`) so an admin can't mistake this deployment for a different one — set it on any non-production resource, e.g. `ENVIRONMENT_LABEL=TEST ENVIRONMENT`. Unset (the default) renders nothing at all; leave it unset on your real production resource.

`DB_FILE` and `HOSTNAME` are already set in the compose file itself — don't set them in Coolify.

## 3. Configure the domain

Set this service's **Domain** in the Coolify UI. Don't hand-author a Traefik router — the compose file only declares `expose: 3000` and a bare `loadbalancer.server.port` label specifically so Coolify's own routing/TLS layer owns this entirely.

## 4. Persistent storage — only matters once you turn on SaaS mode below

The compose file defines a `console-data` named volume mounted at `/app/data`. In self-hosted mode this is present but unused — every real code path that touches this console's own SQLite database (`lib/db.ts`) is gated behind `MULTI_TENANT`, so a self-hosted deployment never actually creates the DB file during normal operation. Nothing to confirm here yet; revisit this step when you enable SaaS mode.

## 5. Deploy and verify

Coolify builds from the repo's `Dockerfile` (multi-stage: builds the Next.js standalone output, then runs it in a slim, non-root Alpine runtime image) and routes traffic to port 3000 through the Domain you configured.

The compose file defines a healthcheck (a plain `GET /login`, expecting `200`) — Coolify's UI will show the service as healthy once that starts passing.

Once it's up, confirm it's actually serving: visit the Domain in a browser and confirm the login page renders with your configured branding (if any), then sign in with `ADMIN_UI_USERNAME`/`ADMIN_UI_PASSWORD` and confirm the dashboard loads. If connected to a real backend, issue a test license through the UI and confirm it appears in the licenses list.

## 6. Backups (beta-readiness finding)

This console's own SQLite database matters more than it might look: under `MULTI_TENANT`, it's the *only* copy of every hosted tenant's encrypted `casazium/license` API key (`accounts.tenant_api_key_encrypted`). Lose it and every one of those tenants' licenses are stranded on that server with no way back in, even though the licenses themselves are untouched — there was previously no backup mechanism for it at all.

**What's set up:** `scripts/backup-db.mjs` (present in the runtime image) takes a WAL-safe, integrity-checked snapshot of `DB_FILE` into `BACKUP_DIR` (`/app/backups` — a separate named volume, `console-backups`, from `console-data`, same reasoning as `casazium/license`'s own backup setup). Prunes snapshots older than `BACKUP_RETENTION_DAYS` (default 14). A Coolify **Scheduled Task** runs `scripts/backup-and-push.sh` (which chains `backup-db.mjs` with an off-box push) daily on both resources (standalone + SaaS-tier) — confirmed live and working directly against the Backblaze B2 bucket's actual contents, not just clean exit codes (`PROJECT_STATUS.md` §57/§58).

**Off-box destination:** Backblaze B2, pushed via `rclone` at the end of `backup-and-push.sh`, with remote retention (`rclone delete --min-age`) matching the local `BACKUP_RETENTION_DAYS` window. Destination path is branched on `MULTI_TENANT` (`licenseServer/console/saas/` vs. `.../standalone/`) so the two resources' backups never land in the same place. Full detail, including two real bugs found and fixed while setting this up, in `PROJECT_STATUS.md` §58.

**Bug found live, 2026-09-22 (same fix applied to `casazium/license`'s identical script): retention wasn't actually freeing storage.** `rclone delete` against B2 hides a file rather than erasing it unless `--b2-hard-delete` is passed - a two-step versioning delete model B2 itself uses. Without that flag, every "pruned" backup was silently kept as a hidden version, forever, at full storage cost - confirmed directly against `casazium/license`'s real bucket contents (four backups from four consecutive days each showed a second, hidden version timestamped ~14 days after their filename's own date, exactly when retention first caught up to them; both repos share the same `licenseServer` B2 bucket, so this affected both). Fixed by adding `--b2-hard-delete` to the `rclone delete` call. Already-hidden versions from before this fix aren't retroactively cleaned up by the flag itself - either a Backblaze Lifecycle Rule on the bucket ("days from hiding to deleting") or a manual purge from Backblaze's own bucket UI clears those out.

This matters for self-hosted deployments too, just less acutely — self-hosted mode barely touches this database at all (every real write is gated behind `MULTI_TENANT`, see the persistent-storage note in step 4 above), so back it up if you've turned SaaS mode on, skip it otherwise.

**Restore procedure** — same shape as `casazium/license`'s own (see that repo's `DEPLOYMENT.md` for the full walkthrough): stop the service, copy the chosen `console-<timestamp>.db` from `/app/backups` over `/app/data/console.db`, remove any stale `-wal`/`-shm` siblings, restart, and verify by signing in and confirming a tenant's licenses still load through their API key.

**Automated restore verification:** `scripts/restore-drill.mjs` runs this same round-trip in an isolated scratch location (never touches the live DB) - integrity check, row counts, and a re-apply of `lib/db/schema.sql` plus the same `MULTI_TENANT` fail-loud guard `lib/db.ts` runs on every real connection open, against a real backup file. `scripts/restore-drill-from-b2.sh` wraps it to pull the latest actual B2 backup first, and is safe to run on the live host as its own Coolify Scheduled Task. Verified locally against synthetic/scratch data (`PROJECT_STATUS.md` §59) - **not yet rehearsed against this specific deployment's real container/volume names.** Do that once for real before relying on it:

```bash
docker exec <container> sh scripts/restore-drill-from-b2.sh
```

## Continuous replication with Litestream (optional, `TASK_LITESTREAM_HA.md`)

An **optional, off-by-default** second backup layer alongside the daily snapshot pipeline above, cutting realistic data-loss exposure on `console.db` from "up to a day" to "a few seconds." Mirrors `casazium/license`'s own Litestream setup mechanically (same binary, same version pin, same derived-path/credential-precedence rules — see that repo's `DEPLOYMENT.md` for the full detail, which applies here verbatim), but the audience is different and worth stating plainly rather than assuming this reads the same as that repo's version:

**Who this actually protects.** Every real write path to `console.db` is gated behind `MULTI_TENANT` (`lib/db.ts`; step 4 above) — a self-hosted deployment never actually creates the DB file during normal operation, so it has essentially nothing in this database worth protecting. `console.db` is only load-bearing on the **SaaS-tier resource Casazium itself operates**, where it holds the only copy of every hosted tenant's encrypted `casazium/license` API key. In practice, only that one Coolify resource will ever set `LITESTREAM_REPLICA_BUCKET` here — a self-hosted deployer who enables it anyway just replicates an empty-or-near-empty database, harmless but not useful.

**The recovery set is simpler here than in `casazium/license`.** That repo's design made "the recovery set, not just the database" the central concept, because its own secrets and a self-license file live on the same volume a database-only restore would silently leave behind. None of that applies to this console: `ACCOUNT_ENCRYPTION_KEY`, `SESSION_SECRET`, `LICENSE_ADMIN_API_KEY`, and every other secret this console needs are ordinary Coolify environment variables, never written to disk — `scripts/backup-db.mjs` already confirms this by omission, backing up `DB_FILE` alone. So the recovery set is the database file itself, full stop — **provided** the environment being restored into already has the correct `ACCOUNT_ENCRYPTION_KEY` (the key that decrypts `accounts.tenant_api_key_encrypted`). Restoring onto the *same* running resource (the overwhelmingly common case) never hits this, since the env vars never move; it only matters when rebuilding the SaaS resource from scratch on new infrastructure.

**Off by default, and this is verified, not assumed:** leave `LITESTREAM_REPLICA_BUCKET` unset and Litestream is never invoked at all — `scripts/start.sh` decides this before Litestream is ever run, so an unconfigured deployment boots through the exact same `node server.js` command it always has.

**Enabling it:**

1. Set `LITESTREAM_REPLICA_BUCKET` (Coolify env var UI) to your own S3-compatible bucket.
2. Set `LITESTREAM_REPLICA_ENDPOINT`/`LITESTREAM_REPLICA_REGION` — effectively required for any provider that isn't real AWS S3 (Backblaze B2, Cloudflare R2, MinIO, etc.). Leave both blank only for real AWS S3.
3. Set credentials as `LITESTREAM_ACCESS_KEY_ID`/`LITESTREAM_SECRET_ACCESS_KEY`. If `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` are *also* set in this container for any other reason, they silently win over the `LITESTREAM_*` pair.
4. The replica's object-storage path is **derived automatically at boot** (the same `saas`/`standalone` branch `scripts/backup-and-push.sh` already uses for its own B2 destination) — there is no path variable to set.

**Verify it's actually reachable, not just configured:** every boot, `scripts/start.sh` runs `litestream restore -if-replica-exists` against the configured destination before starting Litestream for real. A broken/unreachable destination logs loudly and boots anyway — it never blocks this console from starting. Look for one of these two lines in the boot logs:

```
litestream: replica destination reachable (bucket=..., mode=...)
litestream: WARNING - replica destination unreachable or misconfigured (bucket=..., mode=...) - continuing boot anyway, ...
```

**Ongoing observability — load-bearing, not optional, for the same reason as `casazium/license`:** boot succeeding once says nothing about a credential revoked or a bucket deleted days later. Watch Litestream's own `level=ERROR` lines (`consecutive_errors`/`backoff` climbing) and `du -sh /app/data/.*-litestream` for unbounded growth during an outage.

**A real, Litestream-specific restore drill:** `scripts/restore-drill-litestream.sh` runs a real `litestream restore` against the actual configured replica, into a scratch location that never touches the live database, handed off to `restore-drill.mjs`'s existing integrity/row-count/migration checks:

```bash
docker exec <container> sh scripts/restore-drill-litestream.sh
```

**Restoring from Litestream — ordering matters relative to the daily-snapshot procedure above**, identically to `casazium/license`: stop Litestream before any other recovery path touches `/app/data`, or it will resync the replica back down to match an older restored snapshot, undoing the restore.

**Known limitations** (identical to `casazium/license`'s own list — see that repo's `DEPLOYMENT.md` for the full reasoning behind each): no client-side encryption (pinned v0.5.17 dropped it — rely on the storage provider's own server-side encryption at rest); Litestream writes its own bookkeeping (`_litestream_seq`/`_litestream_lock` tables, a hidden `.console.db-litestream/` directory) into the live database and volume; the boot-time check proves read/list access, not write access; `-restore-if-db-not-exists` is deliberately left off in Phase 1.

**SIGTERM / graceful-shutdown verification — resolved, not left open.** `TASK_LITESTREAM_HA.md` flagged an open question before this could ship: whether Next's standalone `server.js` drains an in-flight request on `SIGTERM` before exiting, or drops it. Confirmed directly (both by reading `next/dist/server/lib/start-server.js`'s own `cleanup()` handler and by a live spike — start the real standalone server, open a slow-reading connection, send `SIGTERM` mid-transfer): it registers `SIGTERM`/`SIGINT` handlers that call `server.close()` (stop accepting new connections, let in-flight ones finish) before exiting with the signal-based code (143 for `SIGTERM`). The live spike's in-flight response completed in full (27KB delivered intact) despite `SIGTERM` arriving mid-transfer. See `TASK_LITESTREAM_HA.md`'s own record of this result.

## Deleting the production database to force a fresh boot

Same underlying mechanism as `casazium/license`'s own equivalent section (that repo's `DEPLOYMENT.md`) — deleting the live SQLite file from its named volume so the app recreates it from scratch on next boot. Executed live once this session, immediately after the equivalent wipe on `casazium/license` itself: wiping only `license.db` orphaned every pre-existing `console.db` account (`accounts.tenant_id`/`accounts.tenant_api_key_encrypted` referencing tenants that no longer existed, surfacing as a `409 Conflict` on `/api/signup` for a returning user), which is why this repo needs its own copy of this procedure rather than assuming the other repo's wipe was sufficient — **the two databases are independent and must be wiped together, or not at all, whenever a `license.db` wipe removes tenants this console still has accounts for.**

**If Litestream is enabled on this resource** (`LITESTREAM_REPLICA_BUCKET` set — check Coolify's environment variables UI for this service), **disable it first, before touching the volume**, same reasoning as `casazium/license`'s own equivalent section: Litestream restores from its replica automatically on next boot if it doesn't find a local database that already matches (`scripts/start.sh`'s own `-if-replica-exists` boot check) — delete the local file and restart with Litestream still pointed at the old replica, and it silently repopulates the exact data you just deleted.

1. **If Litestream is enabled, disable it before touching the volume:**
   - Unset `LITESTREAM_REPLICA_BUCKET` in Coolify's environment variables UI for this service and redeploy (not just restart) so the change actually reaches the container.
   - The hidden `.console.db-litestream/` metadata directory on the volume also needs removing (see step 4 below) — otherwise a later re-enable can get confused about generation history. Delete it in the same pass as the database file itself.
   - Skip this step entirely if Litestream was never enabled on this resource — every deployment before this feature existed, and every self-hosted deployment today.
2. **Find the real volume name** the same way as the other repo — Coolify prefixes it with a per-resource UUID, never literally `console-data`:
   ```bash
   docker inspect <container-name-or-id> --format '{{ range .Mounts }}{{ .Name }} -> {{ .Destination }}{{ "\n" }}{{ end }}'
   ```
   Look for the mount whose destination is `/app/data`.
3. **Stop the service in Coolify** if it isn't already down (optional in practice, same reasoning as the other repo's version — the next step works via a throwaway container regardless).
4. **Delete the database from a throwaway container mounting the same volume:**
   ```bash
   docker run --rm -v <real-volume-name>:/data alpine sh -c \
     "rm -f /data/console.db /data/console.db-wal /data/console.db-shm && rm -rf /data/.console.db-litestream && ls -la /data"
   ```
   Confirm the deletion via the final `ls -la` before moving on.
5. **Under `MULTI_TENANT=true`, set `DB_ALLOW_INIT=true` in Coolify's environment variables for this service before restarting** — added after a real incident where a restart hit a missing/detached volume and `lib/db.ts` silently recreated an empty database with nothing in the logs to say so; `MULTI_TENANT=true` alone now requires the file to already exist. This deliberate wipe is exactly the one legitimate case that needs the explicit opt-in. Self-hosted (`MULTI_TENANT` unset/false) needs no such step — it always recreates a missing file.
6. **Restart the service in Coolify.** `lib/db.ts` creates a fresh database from `lib/db/schema.sql` when it finds none, the same defensive-init path that runs on every boot.
7. **Remove `DB_ALLOW_INIT` from the service's environment variables again once the restart has succeeded.** Leaving it set on the long-running resource defeats the guard step 5 just relied on — the next *unintentional* missing-volume incident would once again recreate silently instead of failing loud.
8. **Verify:**
   ```bash
   curl https://<this-service's-domain>/signup
   ```
   returning the signup page confirms the process is up under `MULTI_TENANT=true`; signing in / signing up for real confirms the schema itself is usable.
9. **If this wipe was paired with a `license.db` wipe on `casazium/license`** (the actual scenario this session hit), every account in this console's database now references a tenant that no longer exists on that server — the orphaned-account state this section opened with. Wiping `console.db` too, as described above, is the fix: it clears those stale accounts so new signups against the freshly-empty `license.db` succeed instead of hitting the `409` a stale local account row would otherwise produce.
10. **If you disabled Litestream in step 1, re-enable it now** — set `LITESTREAM_REPLICA_BUCKET` back in Coolify's UI and redeploy. This starts a **fresh replication generation** against the now-empty (or newly-repopulated) database; it will not try to resync the deleted data, since the metadata directory that remembered the old generation was removed in step 4.

### `console-backups` volume — nothing extra to do after a wipe

Deleting `console.db` from `console-data` doesn't touch the separate `console-backups` volume (`/app/backups`, where `scripts/backup-db.mjs` writes its daily snapshots) at all — they're independent named volumes on purpose (see this doc's own Backups section above). No action is needed there: the next scheduled `backup-db.mjs` run simply snapshots whatever the fresh, post-wipe database looks like: an empty `accounts` table under a brand-new schema, same as any other day's backup would capture whatever the database actually contains at run time. The pre-wipe backups already in that volume remain exactly as they were — still real, still restorable if the wipe itself turns out to have been a mistake — and age out on the normal `BACKUP_RETENTION_DAYS` schedule, not because of anything the wipe does.

## 7. Operator notifications (optional, `TASK_ACCOUNT_NOTIFICATIONS.md`)

An optional, off-by-default Discord webhook notification for four events: `account.created`, `account.deleted`, `login`, `logout`. Unset by default in every deployment mode, self-hosted included — nothing changes for anyone who doesn't configure it.

**Enabling it:** create a webhook in a Discord server you control (Server Settings → Integrations → Webhooks → New Webhook), then set `NOTIFY_WEBHOOK_URL` to the URL it gives you. That's the only variable — there's no separate provider selector, and no path/destination to configure beyond the URL itself.

**What each event shows:** `account.created`, `login`, and `logout` carry the real account email under `MULTI_TENANT`, or the configured `ADMIN_UI_USERNAME` in self-hosted mode (self-hosted has no per-user accounts at all, so login/logout are the only two of the four events it ever emits — not a gap, just what that mode has). `account.deleted` deliberately shows only the opaque account ID, never an email — this app's own Privacy Policy promises a deleted hosted account is "permanently deleted... and cannot be recovered," and Discord messages don't expire, so a plaintext email in a permanent deletion notification would outlive that promise indefinitely.

**Known, accepted risks:**
- Self-hosted's `POST /api/logout` doesn't revoke anything (self-hosted has no per-session accounts row to revoke) — a replayed session cookie fires a fresh logout notification each time. Low severity (requires an already-valid, same-origin cookie), but a sustained replay could plausibly trip Discord's own per-webhook rate limit.
- This is an activity feed, not a security-alerting feature — it only fires on *successful* logins, so a failed brute-force attempt produces no Discord activity at all.
- If the local account-deletion transaction were to fail after the remote `casazium/license` tenant deletion already succeeded, no `account.deleted` notification fires — a pre-existing gap in that flow's own error handling, not something this feature introduces.

## Deploying the SaaS-tier instance (SaaS-C1)

Everything above still applies, plus:

1. **Deploy `casazium/license`'s own SaaS-tier instance first** (that repo's `DEPLOYMENT.md`, "Deploying the SaaS-tier instance") — this console's signup flow calls that server's `POST /admin/tenants` at request time, so it needs to already exist and be reachable.
2. **Point `LICENSE_API_URL`/`LICENSE_ADMIN_API_KEY` at that SaaS-tier server specifically** — not your self-hosted one, if you're also running one. These two must be a matched pair from the *same* server resource; mixing them (this console's SaaS instance pointed at a self-hosted server, or vice versa) produces confusing `500`s rather than a clear error, as noted above.
3. **Set `MULTI_TENANT=true`.**
4. **Set `ACCOUNT_ENCRYPTION_KEY`** — 32 bytes, hex-encoded (64 hex characters). Generate: `openssl rand -hex 32`. This is a **different value** from `casazium/license`'s own `ENCRYPTION_KEY` — do not reuse it; these are two independently deployable services and sharing a key would be an unintended cross-service credential coupling, not a simplification (see `.env.example`'s own note on this).
5. **Now confirm persistent storage matters**: revisit step 4 above. Once `MULTI_TENANT=true`, this console's own SQLite database (accounts, sessions) is real and load-bearing — after the first deploy, check Coolify's storage tab and confirm the `console-data` volume is recognized as persistent for this service, not discarded on redeploy.
6. **Set `EMAIL_PROVIDER=resend` plus `RESEND_API_KEY`** (fresh pre-deployment audit finding — this step was previously undocumented here, only mentioned in the README's local-testing section). Signup confirmation and password reset are real, load-bearing flows in SaaS mode, not cosmetic ones — leaving `EMAIL_PROVIDER` unset doesn't just look wrong, it fails loud now (`getEmailProvider()` throws in production multi-tenant mode if this is unset, mirroring `LICENSE_STANDALONE_MODE`'s own explicit-opt-in pattern), specifically because the alternative used to be worse: the stub provider silently "succeeding" while logging the real reset/confirmation link in plaintext to this container's own logs.
7. **Verify a real sending domain on the Resend account, then set `EMAIL_FROM`** to an address on it (e.g. `noreply@casazium.com`) — **required**, not optional, despite what an earlier version of this doc said (beta-readiness finding). Resend's sandbox default (`onboarding@resend.dev`, used when `EMAIL_FROM` is unset) only delivers to *your own* Resend account address, never to a real signup — every confirmation and password-reset email to an actual customer would be silently rejected. `createResendEmailProvider()` now fails loud at request time if this is unset in production, same posture as `EMAIL_PROVIDER` itself.

### Verify SaaS mode is actually on

```bash
curl https://<this-service's-domain>/signup
```

Should return the signup page (`200`), not a `404` — a `404` here means `MULTI_TENANT` didn't actually reach the container. Check it was saved in Coolify's UI and the service was redeployed (not just restarted) after adding it, since Coolify's compose interpolation happens at build/deploy time. (Confirm the compose file's `environment:` block includes both `MULTI_TENANT=${MULTI_TENANT}` and `ACCOUNT_ENCRYPTION_KEY=${ACCOUNT_ENCRYPTION_KEY}` if you're troubleshooting an older checkout — both were added while preparing this doc, alongside the equivalent `MULTI_TENANT` fix in `casazium/license`'s own compose file.)

For a fuller check, sign up a real test tenant through the UI (this calls the real `casazium/license` server and provisions a real tenant there — see that repo's own smoke-test section for how to revoke it afterward) and confirm you land on the onboarding flow, then issue a test license and confirm it appears. Restart the service once from Coolify afterward and confirm the account is still there (log in again) — this confirms the persistent volume from the SaaS section's step 5 is actually wired up, not just present.

## Troubleshooting

### Self-hosted login: "Invalid username or password" with correct credentials

`verifyCredentials()` (`lib/auth.ts`) branches entirely on `isMultiTenant()`. Under self-hosted mode (`MULTI_TENANT` unset), it compares the submitted credentials against `ADMIN_UI_USERNAME`/`ADMIN_UI_PASSWORD` directly — but that's not the only way to land on this exact error message.

**Confirmed root cause once, worth checking first:** `isSameOrigin()` (`lib/config.ts`), called unconditionally at the very top of `/api/login` before any credential check runs, calls `publicBaseUrl()` internally — which throws if `PUBLIC_BASE_URL` is unset in production. That throw isn't caught in the route handler, so it becomes an unhandled 500, and the login form's client-side fallback text reads as "Invalid username or password" when it can't parse a real error body from the response. So this exact symptom can mean either a genuine credential mismatch *or* an unrelated crash earlier in the request — the UI can't tell you which. Check `PUBLIC_BASE_URL` is actually set (see step 2 above) before assuming the username/password themselves are wrong.

**Under `MULTI_TENANT=true`, `ADMIN_UI_USERNAME`/`ADMIN_UI_PASSWORD` are not read at all** — `verifyCredentials()`'s self-hosted branch (where those two vars are checked) is never reached once `isMultiTenant()` is true; that mode checks the `accounts` table instead. Don't set them on a SaaS-mode resource expecting them to do anything; they're simply inert there.

### General: "the site loads but a specific action fails" — verify what the container actually sees, not what Coolify's UI shows

Coolify's environment-variables UI reflects what you *configured*, not necessarily what the *running container* has — a value can be correct in the UI but not yet applied if the container wasn't actually restarted after saving it. Two ways to check, in order of ease:

1. **Coolify's Logs tab** (real-time/streaming container stdout+stderr) on the resource page. Reproduce the failing action while watching it. An unhandled throw (like the `PUBLIC_BASE_URL` one above) prints a full stack trace here even when the browser only shows a generic error.
2. **Exec into the running container** (Coolify's Terminal/Execute Command option, or `docker exec` if you have host SSH access) and read the actual process environment directly:

   ```sh
   echo "MULTI_TENANT=[$MULTI_TENANT]"
   echo "PUBLIC_BASE_URL=[$PUBLIC_BASE_URL]"
   echo "ADMIN_UI_USERNAME=[$ADMIN_UI_USERNAME]"
   echo "ADMIN_UI_PASSWORD length: ${#ADMIN_UI_PASSWORD}"
   ```

   The brackets make stray leading/trailing whitespace visible (e.g. `[admin ]` vs `[admin]`) — Coolify's env-var UI takes values literally with no shell-style trimming, so a pasted trailing space or an accidentally-included quote character breaks an exact-match comparison silently. Password length is checked rather than the value itself printed, to avoid it landing in shell scrollback/history.
