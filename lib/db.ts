import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isMultiTenant } from './config';

/**
 * Persistence layer (SaaS-B1a). SQLite via better-sqlite3, the same
 * choice casazium/license made for its own SaaS-tier data (that repo's
 * PROJECT_STATUS.md §8, C2) - matches this console's actual deployment
 * topology today (one Coolify service, no replica count set), not a
 * hypothetical multi-replica shape. Revisit if SaaS-C1 ever picks
 * multi-replica hosting for this specific service - SQLite can't be
 * safely shared across processes without infrastructure not planned
 * here (see C2's own equivalent caveat for the server).
 *
 * No accounts/sessions tables exist yet - this module is purely the
 * connection lifecycle and migration mechanism; SaaS-B1b/B1c own the
 * actual schema, added to lib/db/schema.sql.
 *
 * No migration framework, mirroring casazium/license's own convention
 * (its src/app.js comment: "no migration framework exists in this
 * repo") - lib/db/schema.sql is `CREATE TABLE IF NOT EXISTS`, safe to
 * re-run unconditionally on every connection open.
 */

// Next.js dev mode (Fast Refresh) re-executes a module's top-level code
// on every hot reload. Without stashing the instance on `globalThis`,
// each reload would open a new handle onto the same file rather than
// reuse one, leaking file descriptors across saves - the standard
// Next.js + native-database-driver singleton pattern. Production
// (.next/standalone/server.js) is one persistent process with no HMR,
// so this only matters in dev, but it's harmless either way.
declare global {
  var __consoleDb: Database.Database | undefined;
}

function openDatabase(): Database.Database {
  const dbPath = process.env.DB_FILE || './data/console.db';
  // turbopackIgnore: this resolves the *database* file's own path (passed
  // to `new Database()` below, a runtime SQLite file open, not a module
  // import or a file this code reads as source) - without the ignore
  // comment, Turbopack's build-time tracer can't tell this apart from a
  // dynamic require() and falls back to tracing the entire project as a
  // dependency of this route (confirmed: reproduced the exact "whole
  // project was traced unintentionally" warning without this comment).
  const absoluteDbPath = path.isAbsolute(dbPath)
    ? dbPath
    : path.join(/* turbopackIgnore: true */ process.cwd(), dbPath);
  console.log('Console database path:', absoluteDbPath);

  // better-sqlite3 does not create missing parent directories itself -
  // the Dockerfile's own `RUN mkdir -p /app/data` masked this for
  // container deployments, but any bare-metal run (`next dev`,
  // `node .next/standalone/server.js` outside Docker, or DB_FILE
  // pointed at a not-yet-created path) crashed on first open instead.
  mkdirSync(path.dirname(absoluteDbPath), { recursive: true });

  // fileMustExist under MULTI_TENANT=true, unless DB_ALLOW_INIT=true is
  // also set (real production incident, not hypothetical): a restart of
  // the SaaS-tier resource hit a missing console.db and, with no guard,
  // better-sqlite3 silently created a fresh empty file - which the
  // CREATE TABLE IF NOT EXISTS below then populated with a valid,
  // completely empty schema. The app booted looking perfectly healthy
  // while every account, encrypted tenant_api_key_encrypted, and session
  // was gone, with nothing in the logs to say so.
  //
  // MULTI_TENANT=true alone isn't enough to require an existing file -
  // this repo's own test suite legitimately bootstraps a fresh SQLite
  // file under MULTI_TENANT=true for isolated test runs (confirmed:
  // tests/routes/password-reset-email-verification.test.ts and others
  // stub a brand-new per-PID temp path with no separate init step), and
  // a genuine first-ever launch of the SaaS resource (or a from-scratch
  // disaster-recovery redeploy, per TASK_LITESTREAM_HA.md's own recovery
  // notes) needs the same one-time bootstrap. DB_ALLOW_INIT=true is that
  // explicit, deliberate opt-in - tests set it alongside their other env
  // stubs, and DEPLOYMENT.md documents it as a one-time step for a
  // genuine first launch, never left set on the long-running resource
  // afterward. A self-hosted deployment is the case this file's own
  // header comment already documents as a deliberate design goal (no
  // migration framework, zero-friction fresh install) and its accounts
  // table is expected to start empty and hold nothing worth protecting
  // (TASK_LITESTREAM_HA.md's own reasoning) - unaffected either way.
  const requireExistingFile = isMultiTenant() && process.env.DB_ALLOW_INIT !== 'true';

  // Checked before opening, not inferred afterward (better-sqlite3 gives
  // no way to tell "opened existing" from "just created" once the handle
  // is open) - mirrors casazium/license's own src/app.js fix, added for
  // the same reason: an operator restarting this service under
  // DB_ALLOW_INIT=true had no log line telling them whether it just
  // created a fresh database or opened the existing one as-is.
  const dbFileExistedBeforeOpen = existsSync(absoluteDbPath);
  if (isMultiTenant() && process.env.DB_ALLOW_INIT === 'true') {
    if (dbFileExistedBeforeOpen) {
      console.warn(
        `DB_ALLOW_INIT=true is set but ${absoluteDbPath} already exists - it will be opened as-is, not created. ` +
          'Set DB_ALLOW_INIT=false (or unset it) now that this deployment is initialized - leaving it set silently ' +
          'disables the guard that would otherwise catch a future missing/detached volume.'
      );
    } else {
      console.warn(
        `${absoluteDbPath} did not exist - creating a fresh database because DB_ALLOW_INIT=true is set. ` +
          'Remove DB_ALLOW_INIT (or set it to false) once this boot succeeds.'
      );
    }
  }

  const database = new Database(
    absoluteDbPath,
    requireExistingFile ? { fileMustExist: true } : undefined
  );

  // WAL mode: casazium/license's own C2 spike (scripts/bench-concurrency.js
  // in that repo) measured a real, modest tail-latency improvement with no
  // observed downside - enabled here from day one rather than repeating
  // that measurement for a second, lower-traffic SQLite file.
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');

  // Resolved relative to process.cwd(), which is /app in both `next dev`
  // (project root) and the standalone runtime (Dockerfile's WORKDIR) -
  // scripts/copy-standalone-assets.mjs copies this file alongside
  // public/ and .next/static for the same reason it copies those: Next's
  // standalone output tracer only follows the JS import graph, not
  // runtime fs.readFileSync() paths to non-JS files like this one.
  const schemaPath = path.join(process.cwd(), 'lib', 'db', 'schema.sql');
  const schemaSql = readFileSync(schemaPath, 'utf-8');
  database.exec(schemaSql);

  // Defensive migration, same pattern and reasoning as casazium/license's
  // own src/app.js (that repo's identical comment): CREATE TABLE IF NOT
  // EXISTS above is a no-op against a database file that already has the
  // table, so an existing deployment - the beta is live - needs the new
  // account-settings email-change column (schema.sql's own comment on
  // new_email) added explicitly rather than picked up for free.
  const emailVerificationTokenColumns = database.prepare('PRAGMA table_info(email_verification_tokens)').all() as {
    name: string;
  }[];
  if (!emailVerificationTokenColumns.some((col) => col.name === 'new_email')) {
    database.exec('ALTER TABLE email_verification_tokens ADD COLUMN new_email TEXT');
  }

  // Fail loud, not fail open (security review finding, fresh
  // pre-deployment audit, mirrors casazium/license's own equivalent
  // guard in that repo's src/app.js): if MULTI_TENANT is off but the
  // `accounts` table already holds rows, this is a SaaS deployment
  // whose flag was dropped (env var lost on redeploy, config drift, an
  // operator mistake), not a genuine self-hosted install. Without this
  // check, verifyCredentials() falls back to the single shared
  // ADMIN_UI_USERNAME/PASSWORD pair (still blocking new logins for real
  // accounts), but the deeper hole is verifySessionToken(): its
  // isMultiTenant() branch - the only place that looks up tenant_id,
  // checks tenant_revoked_at, and checks sessions_revoked_at - is
  // skipped entirely, so any still-unexpired JWT issued while
  // MULTI_TENANT was on (including one for a since-revoked tenant)
  // keeps verifying as a valid, tenant-less 'admin' identity. Every
  // license-server call that identity makes then falls through
  // license-client.live.ts's own resolveApiKey() to the single shared
  // LICENSE_ADMIN_API_KEY, since isMultiTenant() is false there too -
  // an existing SaaS session silently gets platform-wide admin access
  // instead of just its own tenant's. A genuinely fresh self-hosted
  // install has an empty accounts table and boots normally; this only
  // fires once real SaaS account data exists.
  if (!isMultiTenant()) {
    const accountCount = (
      database.prepare('SELECT COUNT(*) AS n FROM accounts').get() as { n: number }
    ).n;
    if (accountCount > 0) {
      throw new Error(
        `Refusing to start: MULTI_TENANT is not set to 'true' but the accounts table has ${accountCount} row(s). ` +
          "Starting anyway would let any still-valid session silently fall back to the platform-wide admin key. " +
          'Set MULTI_TENANT=true, or point DB_FILE at a genuinely self-hosted database.'
      );
    }
  }

  // Expired-token pruning (security review finding L4): both token
  // tables accumulate a row per signup/resend/forgot-password request
  // and were never cleaned up - each row deletes itself individually on
  // successful use (reset-password.ts, verify-email/route.ts), but a
  // token nobody ever redeems (an abandoned signup, a reset link never
  // clicked) just sits there past its own expiry forever. Same pattern
  // as casazium/license's own tenant_auth_log retention (that repo's
  // src/app.js): run once at boot, then on an unref()'d daily interval
  // so it can't hold the process open. Deletes by expires_at, not a
  // fixed age, since these tokens already carry their own real
  // (short, 1h/24h) TTL - no separate retention window to invent.
  //
  // datetime(expires_at), not the raw column (security review finding,
  // fresh pre-deployment audit): expires_at is stored as a
  // JS-generated ISO 8601 string ("2026-08-06T13:00:00.000Z"), but
  // SQLite has no native DATETIME type - it compares TEXT lexically,
  // and datetime('now') produces its own space-separated, no-millisecond,
  // no-'Z' format ("2026-08-06 13:00:00"). 'T' (0x54) sorts after ' '
  // (0x20), so any same-date comparison against the raw column read as
  // "not yet expired" regardless of the actual time - confirmed: a
  // token that expired 1 minute ago still compared as not-expired.
  // Redemption itself was never affected (reset-password.ts and
  // verify-email/route.ts both use a real `new Date(...) < new Date()`
  // comparison in JS, not this query) - this was retention hygiene
  // only, not a security hole, but a real bug in code written this
  // session regardless. Wrapping both sides in datetime() normalizes
  // them to the same comparable representation.
  const pruneExpiredTokens = () => {
    database.prepare(`DELETE FROM email_verification_tokens WHERE datetime(expires_at) < datetime('now')`).run();
    database.prepare(`DELETE FROM password_reset_tokens WHERE datetime(expires_at) < datetime('now')`).run();
  };
  pruneExpiredTokens();
  const pruneInterval = setInterval(pruneExpiredTokens, 24 * 60 * 60 * 1000);
  pruneInterval.unref();

  return database;
}

export function getDb(): Database.Database {
  if (!globalThis.__consoleDb) {
    globalThis.__consoleDb = openDatabase();
  }
  return globalThis.__consoleDb;
}
