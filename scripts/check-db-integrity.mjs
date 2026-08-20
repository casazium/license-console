// scripts/check-db-integrity.mjs
//
// Operator asked directly whether a database integrity test exists at
// all, right after a real cross-database-atomicity gap surfaced in
// account deletion (BETA_LAUNCH_STATUS.md v1.17, casazium/casazium):
// if casazium/license's own delete succeeds but this console's local
// cleanup then fails, the tenant's `accounts` row survives as an
// orphaned shell. This script is the check that would surface exactly
// that kind of leftover, plus SQLite's own structural-corruption check
// - matches casazium/license's own new scripts/check-db-integrity.js,
// same two pragmas, same reasoning. See that file's own header comment
// for the fuller rationale; not repeated here.
//
// No CI wiring here, unlike casazium/license's counterpart (which also
// has an equivalent Vitest test that runs on every `npm test`) - this
// repo has no automated test suite at all (no test script in
// package.json, confirmed), so there's no CI run for a test to hook
// into. This script is ad hoc only: run it manually, or after any
// direct DB surgery, or as an operational check alongside a real backup.
//
// Uses better-sqlite3, already a runtime dependency here (lib/db.ts).
//
// Usage: node scripts/check-db-integrity.mjs [path-to-db-file]
// Defaults to DB_FILE (or ./data/console.db) - the same live-database
// default backup-db.mjs uses. Pass an explicit path to check a backup
// file or a restore-drill scratch copy instead.

import Database from 'better-sqlite3';
import path from 'node:path';

const explicitPath = process.argv[2];
const dbPath = explicitPath || process.env.DB_FILE || './data/console.db';
const absoluteDbPath = path.isAbsolute(dbPath) ? dbPath : path.resolve(dbPath);

function main() {
  console.log(`Checking ${absoluteDbPath}`);
  const db = new Database(absoluteDbPath, { readonly: true });
  let ok = true;

  try {
    // Not { simple: true } - a corrupt database can return more than
    // one row describing distinct problems, and simple mode would
    // silently show only the first.
    const integrityRows = db.pragma('integrity_check');
    const integrityOk = integrityRows.length === 1 && integrityRows[0].integrity_check === 'ok';
    if (integrityOk) {
      console.log('[1/2] integrity_check: ok');
    } else {
      ok = false;
      console.error('[1/2] integrity_check: FAILED');
      for (const row of integrityRows) {
        console.error(`  - ${row.integrity_check}`);
      }
    }

    const fkViolations = db.pragma('foreign_key_check');
    if (fkViolations.length === 0) {
      console.log('[2/2] foreign_key_check: ok (no dangling foreign keys)');
    } else {
      ok = false;
      console.error(`[2/2] foreign_key_check: FAILED (${fkViolations.length} violation(s))`);
      for (const violation of fkViolations) {
        console.error(
          `  - ${violation.table} row ${violation.rowid} references missing ${violation.parent} row (fkid ${violation.fkid})`
        );
      }
    }
  } finally {
    db.close();
  }

  if (!ok) {
    console.error('\nDatabase integrity check FAILED.');
    process.exit(1);
  }
  console.log('\nDatabase integrity check passed.');
}

main();
