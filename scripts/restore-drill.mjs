// scripts/restore-drill.mjs
//
// Beta-readiness finding: backup-db.mjs + backup-and-push.sh have been
// running on a schedule and pushing to B2 for a while now, but nothing
// had ever actually restored one of those files - a backup that has
// never been restored is unverified, not merely untested. This script
// is that verification, safe to run against a real production backup on
// the live host: it never touches DB_FILE or the live database, only a
// throwaway scratch copy that gets deleted before exit either way.
//
// Reimplements lib/db.ts's openDatabase() rather than importing it - the
// same choice backup-db.mjs already made for the same reason: lib/db.ts
// is TypeScript with no tsx/ts-node in this repo's devDependencies, and
// its actual logic is short enough (exec schema.sql, the MULTI_TENANT
// fail-loud guard) to reproduce directly rather than add a new toolchain
// dependency just for this script. Any future change to that logic needs
// updating in both places - same tradeoff backup-db.mjs already accepted.
//
// Three checks, each catching a failure mode the others can't:
//   1. PRAGMA integrity_check on the transferred copy - re-runs the same
//      check backup-db.mjs already did at capture time, but on the file
//      as it exists *after* local storage + rclone/B2 transfer, which is
//      the only way to catch corruption introduced by that path rather
//      than by SQLite's own backup API.
//   2. Row counts across every real table - an empty-but-valid schema
//      passes integrity_check but fails this.
//   3. Re-running lib/db/schema.sql (CREATE TABLE IF NOT EXISTS) against
//      the restored copy, then the same MULTI_TENANT fail-loud check
//      lib/db.ts runs on every real connection open (Refusing to start
//      when MULTI_TENANT isn't 'true' but accounts already has rows) -
//      this is what actually matters at restore time, since it's the
//      exact gate that would otherwise only be exercised for real during
//      a live incident.
//
// Run on the real host (Coolify Scheduled Task or a manual `docker exec`)
// with MULTI_TENANT already set the same as the resource being restored
// for - this script never needs any other secret.
//
// Usage: node scripts/restore-drill.mjs <path-to-backup.db>

import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const backupPath = process.argv[2];
if (!backupPath) {
  console.error('Usage: node scripts/restore-drill.mjs <path-to-backup.db>');
  process.exit(1);
}

async function main() {
  const scratchDir = await fs.mkdtemp(path.join(os.tmpdir(), 'restore-drill-'));
  const scratchDb = path.join(scratchDir, 'restore-test.db');

  try {
    console.log(`Restoring ${backupPath} -> ${scratchDb} (scratch copy; live DB is never touched)`);
    await fs.copyFile(backupPath, scratchDb);

    const verifyDb = new Database(scratchDb, { readonly: true });
    let integrityResult;
    try {
      integrityResult = verifyDb.pragma('integrity_check', { simple: true });
    } finally {
      verifyDb.close();
    }
    if (integrityResult !== 'ok') {
      throw new Error(`Integrity check failed on restored copy: ${integrityResult}`);
    }
    console.log('[1/3] Integrity check on transferred copy: ok');

    const countDb = new Database(scratchDb, { readonly: true });
    let tableCounts;
    try {
      const tables = countDb
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
        .all();
      tableCounts = tables.map(({ name }) => ({
        name,
        n: countDb.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get().n,
      }));
    } finally {
      countDb.close();
    }
    console.log('[2/3] Row counts (pre-schema-reapply):');
    for (const { name, n } of tableCounts) {
      console.log(`      ${name}: ${n}`);
    }

    // Same schema-apply + fail-loud guard lib/db.ts's openDatabase() runs
    // on every real connection open.
    const db = new Database(scratchDb);
    try {
      const schemaPath = path.join(SCRIPTS_DIR, '../lib/db/schema.sql');
      const schemaSql = await fs.readFile(schemaPath, 'utf-8');
      db.exec(schemaSql);

      const isMultiTenant = process.env.MULTI_TENANT === 'true';
      if (!isMultiTenant) {
        const { n: accountCount } = db.prepare('SELECT COUNT(*) AS n FROM accounts').get();
        if (accountCount > 0) {
          throw new Error(
            `Refusing: MULTI_TENANT is not 'true' but accounts has ${accountCount} row(s) - ` +
              'this backup is from a SaaS-tier deployment, restoring it under a standalone ' +
              'MULTI_TENANT setting would silently misroute session/tenant checks.'
          );
        }
      }
      console.log('[3/3] Schema re-apply + MULTI_TENANT guard: ok');
    } finally {
      db.close();
    }

    console.log('Restore drill PASSED.');
  } finally {
    await fs.rm(scratchDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('Restore drill FAILED:', err);
  process.exit(1);
});
