import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

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

  const database = new Database(absoluteDbPath);

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
  const pruneExpiredTokens = () => {
    database.prepare(`DELETE FROM email_verification_tokens WHERE expires_at < datetime('now')`).run();
    database.prepare(`DELETE FROM password_reset_tokens WHERE expires_at < datetime('now')`).run();
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
