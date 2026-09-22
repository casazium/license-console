# Task scope: continuous replication via Litestream (console.db)

Status: **Built, Phase 1.** The SIGTERM spike this document originally gated implementation on (see "Open question" below) has been run and resolved in the affirmative — implementation proceeded on that basis. `scripts/start.sh`, `litestream.yml`, the Dockerfile changes, `.env.example` entries, `scripts/restore-drill-litestream.sh`, and the `DEPLOYMENT.md` Litestream section all exist now, mirroring `casazium/license`'s own `TASK_LITESTREAM_HA.md` (Built, Phase 1). **Not yet verified live against a real S3-compatible bucket on the actual SaaS-tier Coolify resource** — that remains the bar to clear before this is exercised in anger; see "What done would look like" below for what's still outstanding.

**Why a separate document, not just "do the same thing again":** the two databases share a mechanism (same Litestream binary, same off-by-default branch, same credential/path-derivation conventions) but differ enough in what depends on them that copying `casazium/license`'s design verbatim would misstate the risk in two places — who actually benefits from this, and what the "recovery set" contains. Both differences are worked out below rather than assumed.

## What this is

Add Litestream as an optional, continuous WAL-streaming backup layer for `console.db`, alongside this repo's existing daily `backup-db.mjs`/B2 snapshot pipeline (`DEPLOYMENT.md`'s Backups section) — cutting realistic data-loss exposure on this database from "up to a day" to "a few seconds," the same improvement `casazium/license` already shipped for `license.db`.

## Who this actually protects — read before assuming this mirrors `license.db`

`casazium/license`'s Litestream work was framed around a self-hosted operator's independence from Casazium: any deployment of that codebase, including ones Casazium never sees, benefits. **That framing does not transfer directly here.** Confirmed against this repo's own code and `DEPLOYMENT.md` before writing this doc, not assumed:

- Every real write path to `console.db` is gated behind `MULTI_TENANT` (`lib/db.ts`; `DEPLOYMENT.md` step 4: "a self-hosted deployment never actually creates the DB file during normal operation"). A self-hosted `casazium/license-console` instance has essentially nothing in this database worth protecting.
- `console.db` is only load-bearing on the **SaaS-tier resource** — the one Casazium itself operates — where it holds the *only* copy of every hosted tenant's encrypted `casazium/license` API key (`accounts.tenant_api_key_encrypted`). Losing it doesn't lose the licenses themselves, but strands every tenant's access to them with no way back in (`DEPLOYMENT.md`'s existing Backups section already makes this point for the daily-snapshot case).

So this task is really about **Casazium's own operational resilience for its hosted product**, not a self-hosted-customer guarantee. That changes nothing about the mechanism itself (still opt-in, still the operator's own bucket, never a Casazium default — kept for consistency and because a self-hosted operator who *does* turn it on shouldn't hit a different code path than the SaaS resource does), but it does mean: in practice, only the SaaS-tier Coolify resource will ever set `LITESTREAM_REPLICA_BUCKET` here. A self-hosted deployer who enables it anyway just replicates an empty-or-near-empty database — harmless, not useful.

## The recovery set — simpler here, confirmed rather than assumed

`casazium/license`'s design made "the recovery set, not just the database" its central concept, because that repo's `backup-db.js` had to learn to also capture `.secrets.json`, a Tier-A license file, and a self-license directory — real files on the same volume that a database-only restore would silently leave behind, producing a server that boots with freshly-minted secrets against old data, or refuses to boot at all.

**None of that applies here.** Checked directly against this repo before writing this section:

- `ACCOUNT_ENCRYPTION_KEY`, `SESSION_SECRET`, `LICENSE_ADMIN_API_KEY`, and every other secret this console needs are ordinary Coolify environment variables (`docker-compose-coolify.yml`'s `environment:` block) — never written to a file on `/app/data` or anywhere else on disk. There is no `AUTO_GENERATE_SECRETS` equivalent in this repo and no `.secrets.json`.
- `scripts/backup-db.mjs` confirms this by omission: it backs up `DB_FILE` alone, nothing else — unlike `casazium/license`'s `backup-db.js`, which was extended specifically because it *wasn't* capturing enough.

So the recovery set for `console.db` is the database file itself, full stop — **provided** the environment being restored into already has the correct `ACCOUNT_ENCRYPTION_KEY` (the key that decrypts `accounts.tenant_api_key_encrypted`). That's not a file-capture gap to close; it's an operator discipline point worth stating plainly: **restoring `console.db` onto a resource whose Coolify environment variables don't already match the ones it was captured under produces a database full of ciphertext nothing can decrypt.** Restoring onto the *same* running resource (the overwhelmingly common case — a bad migration, an accidental delete, this session's own two live DB-wipe incidents) never hits this, since the env vars never move. It only matters for a genuine disaster-recovery scenario (rebuilding the SaaS resource from scratch on new infrastructure) — call this out in the eventual `DEPLOYMENT.md` addition, not something this design needs new machinery for.

## The mechanism — reused, not reinvented

Same binary, same version pin, same derivation conventions as `casazium/license`, for the same reason that repo gives: an operator (in this case, Casazium itself) who runs both should not need to learn two different systems.

- **Litestream v0.5.17**, same pin, same reasoning (LTX format, `checkDatabaseBehindReplica` behavior, no client-side encryption as of this version — see `casazium/license`'s `TASK_LITESTREAM_HA.md` "Version: pin v0.5.17" section for the full detail; it applies verbatim here).
- **Binary provenance**: same Dockerfile pattern as `casazium/license` — pinned version, `TARGETARCH`-based download, `sha256sum -c` against the published checksums file. This repo's Dockerfile already has an `apk add rclone` precedent for pulling in an external binary at build time (see the Backups section of this repo's `docker-compose-coolify.yml` header comment); the Litestream fetch would be a second instance of that same pattern, not a new one.
- **Credential precedence**: identical to `casazium/license` — `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, if present in the container for any other reason, silently win over `LITESTREAM_ACCESS_KEY_ID`/`LITESTREAM_SECRET_ACCESS_KEY`. This is a property of the Litestream binary itself, not something either repo's config controls — worth restating here rather than just cross-referencing, since it's exactly the kind of thing that's easy to forget applies to *this* repo too.
- **Replica path derivation**: reuse the same "derive, never hand-set" rule, adapted to this repo's own existing branch. `scripts/backup-and-push.sh` in this repo already derives its own B2 destination as `licenseServer/console/saas/` vs. `licenseServer/console/standalone/` based on `MULTI_TENANT` (`DEPLOYMENT.md`'s Backups section) — a two-way branch, not `casazium/license`'s three-way `mls`/`saas`/`standalone` one, since this repo has no MLS-equivalent concept. The Litestream replica path should follow the identical two-way branch and land under `licenseServer/console/${MODE}/litestream`, mirroring the daily-snapshot path exactly one level down, so the two pipelines' destinations are trivially correlated by a human reading the bucket listing.
- **Fail-loud-vs-fail-open policy**: same as `casazium/license` — a boot-time `litestream restore -if-replica-exists` reachability check that logs a `WARNING` and **continues booting** on failure, never blocks the primary service. This is a backup layer, not a dependency this app needs to run, in this repo exactly as much as in that one.
- **Ongoing observability**: same load-bearing caveat — boot succeeding once says nothing about a credential revoked or a bucket deleted three days later. Same guidance applies: watch for Litestream's own `level=ERROR` lines with a climbing `consecutive_errors`, and watch `<data-dir>/.<dbname>-litestream/` for unbounded growth during a real outage.
- **Restore-ordering rule**: unchanged and equally load-bearing here — **stop Litestream before any other recovery path touches `/app/data`**, or it will dutifully resync the replica back down to match an older restored snapshot, undoing the restore.
- **`-restore-if-db-not-exists` left off in Phase 1**, same reasoning as `casazium/license`: combined with a hand-set (rather than derived) path, that flag is exactly the mechanism that could let a fresh, misconfigured container silently adopt someone else's database. The derived-path rule above closes most of that risk but this repo, like that one, should defer actually flipping the flag to a later phase.

## Where this actually differs: there is no `start.sh` to extend

This is the one place a straight copy of `casazium/license`'s design would be wrong, and it's worth being explicit about why.

`casazium/license`'s container already ran through a wrapper (`scripts/docker-entrypoint.js`) before Litestream existed, so adding the on/off branch meant inserting `scripts/start.sh` *ahead of* an existing indirection layer — the result is a three-layer chain (`start.sh` → `litestream replicate -exec` → `docker-entrypoint.js` → the app).

**This repo's Dockerfile has no such layer.** `CMD ["node", "server.js"]` execs the Next.js standalone server directly, with no shell wrapper at all today (`Dockerfile:93`). Adding the same on/off branch here means:

1. Writing a *new* `scripts/start.sh` (this repo currently has none) with the identical shape to `casazium/license`'s — the `[ -z "$LITESTREAM_REPLICA_BUCKET" ]` check decided **before** Litestream is ever invoked, for the identical reason: Litestream's own config validation runs before launching a wrapped process, so an empty bucket var left to Litestream itself would fail the *entire container* to start, not just skip replication, for every deployment that doesn't opt in (which today is all of them).
2. Changing `Dockerfile`'s `CMD` from `["node", "server.js"]` to `["sh", "scripts/start.sh"]`, with the unset-bucket branch `exec`-ing directly into `node server.js` — byte-identical to today's behavior for every deployment that never sets the bucket var.
3. The resulting chain is **two layers, not three** (`start.sh` → `litestream replicate -exec "node server.js"` → the app directly) — one fewer process hop than `casazium/license`'s chain, since this repo has no separate entrypoint script to preserve underneath the app itself.

## Open question, now resolved: does `server.js` actually shut down cleanly on SIGTERM?

`casazium/license`'s design doc could state its process/signal integration as *verified*, because a real spike ran the actual three-layer chain against a live Fastify instance and confirmed `SIGTERM` propagates cleanly, `app.js`'s graceful-shutdown handler fires, and a restore reproduced every issued license exactly.

**Resolved for this repo, by both source inspection and a live spike, not assumed by analogy to `casazium/license`'s different app framework:**

- **Source**: `node_modules/next/dist/server/lib/start-server.js` (the module `.next/standalone/server.js` calls into) registers `process.on('SIGTERM', cleanup)` and `process.on('SIGINT', cleanup)` unless `NEXT_MANUAL_SIG_HANDLE` is set (it isn't, in this deployment). `cleanup()` calls `server.close()` — Node's standard "stop accepting new connections, let in-flight ones finish" — awaits it, then runs Next's own internal teardown, and only then calls `process.exit(143)` for `SIGTERM` (the signal-based exit code, same convention `casazium/license`'s own spike found). This is real graceful shutdown, not an immediate kill — nothing about it depends on Litestream, dev-mode-only behavior (`closeAllConnections()` is gated behind `isDev`, which is `false` in the production build), or this specific route's code.
- **Live spike**: built the actual standalone output (`npm run build`), ran `node .next/standalone/server.js` directly (outside Docker/Litestream, since the question is specifically about `server.js`'s own signal handling, which neither Docker nor Litestream's `-exec` wrapping changes), opened a request against `/login` with `curl --limit-rate 2k` to force a slow, still-in-flight read, and sent `SIGTERM` to the server process mid-transfer. Result: the full response (27,060 bytes, HTTP 200) was delivered intact and the process then exited — confirming the connection drains rather than resets, exactly the outcome this document required before treating this as safe to ship.

The relevant uncertainty was narrower than it looked — Litestream's own replication correctness never depended on this (SQLite's WAL is durable one transaction at a time regardless of how the process exits, and Litestream watches the WAL file, not the app's lifecycle). What depended on it was Coolify's ordinary redeploy/restart behavior: whether an in-flight request gets to finish before the process dies. It does.

## Non-goals (same posture as `casazium/license`, restated for this repo)

- No failover or promotion — a lost primary still means someone manually restores from the replica onto a new resource and re-points DNS/Domain, exactly as with the daily-snapshot path today.
- No client-side encryption — same v0.5.17 limitation, same reliance on the destination provider's own server-side encryption-at-rest.
- No SEA build consideration — this repo has no single-executable build target (`casazium/license`'s `publish-sea.yml` has no counterpart here), so that entire caveat from the other repo's doc simply doesn't apply and is dropped rather than carried forward as dead text.
- No change to self-hosted mode's actual behavior or risk profile — as established above, self-hosted `console.db` has nothing worth protecting; this feature existing and being off by default changes nothing for that deployment shape.

## Decided by the operator (same defaults as `casazium/license`, pending confirmation)

- Off by default; a deployment must explicitly set `LITESTREAM_REPLICA_BUCKET` to opt in.
- Boot-time reachability check fails loud (logs a `WARNING`) but never blocks boot.
- Phase 1 ships without `-restore-if-db-not-exists`.

These mirror `casazium/license`'s own settled decisions rather than reopening them — no reason has surfaced to make this repo behave differently on any of the three.

## Open questions

1. ~~**The SIGTERM spike above** — must be run and its result recorded here before this moves from "proposed" to "built."~~ Resolved — see the section above.
2. ~~**Is Phase 1 worth building at all given the audience is effectively "the SaaS-tier resource only"?**~~ Resolved by direct operator instruction: build and enable it, alongside re-enabling `casazium/license`'s own Litestream setup in the same session. Not reopened further.
3. Same config-file-vs-CLI-args question `casazium/license` already resolved in favor of a config file (auditability, multiple fields at once) — same answer here, not reopened, inherited rather than independently decided.

## What done would look like

- [x] SIGTERM spike run against the real chain, result recorded above
- [x] `scripts/start.sh` written
- [x] `litestream.yml` template written, following `casazium/license`'s exact structure with the two-way (not three-way) mode branch
- [x] Litestream binary fetch added to `Dockerfile`, same pinned-version + `TARGETARCH` + `sha256sum -c` pattern
- [x] `Dockerfile`'s `CMD` changed to `["sh", "scripts/start.sh"]`
- [x] New env vars documented in `.env.example`: `LITESTREAM_REPLICA_BUCKET`, `LITESTREAM_REPLICA_ENDPOINT`, `LITESTREAM_REPLICA_REGION`, `LITESTREAM_ACCESS_KEY_ID`, `LITESTREAM_SECRET_ACCESS_KEY`
- [x] A real restore-drill-against-Litestream script, mirroring `casazium/license`'s `restore-drill-litestream.sh` wired to this repo's own `restore-drill.mjs`
- [x] `DEPLOYMENT.md` gains a Litestream section for this repo, including the recovery-set note above (console.db alone is sufficient, provided the target's env vars already match) and the restore-ordering rule
- [ ] Verified live against a real S3-compatible bucket on the actual SaaS-tier Coolify resource, the same bar `casazium/license`'s rollout was held to before it was marked Built — **the one remaining item**, an operator action (set the Coolify env vars, redeploy, confirm the "replica destination reachable" boot log line) rather than something buildable in advance.
- [ ] `PROJECT_STATUS.md` entry recording the above, once done
