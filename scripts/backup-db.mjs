// scripts/backup-db.mjs
//
// Beta-readiness finding: no backup mechanism existed anywhere in this
// repo or its deployment docs for this console's own SQLite database -
// which is where every hosted tenant's *only* copy of their own
// casazium/license API key lives (accounts.tenant_api_key_encrypted,
// lib/tenant-context.ts). Losing this volume doesn't just lose account
// data - it permanently strands every tenant's licenses on
// casazium/license with no way for that tenant to reach them again. See
// that repo's own scripts/backup-db.js for the matching backup on its
// side; both must be backed up, and losing either one is bad in a
// different way (see BACKUP_DIR below and DEPLOYMENT.md's Backups
// section for the full picture).
//
// Uses better-sqlite3's own online backup API (already a runtime
// dependency here - lib/db.ts), which is WAL-safe: a consistent snapshot
// of a live database without stopping writes, unlike a plain file copy
// of a WAL-mode database.

import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.dirname(fileURLToPath(new URL('.', import.meta.url)));

const dbPath = process.env.DB_FILE || './data/console.db';
const absoluteDbPath = path.isAbsolute(dbPath) ? dbPath : path.resolve(dbPath);

// Deliberately NOT defaulted to a path under the same volume as DB_FILE
// (e.g. /app/data) - see casazium/license's scripts/backup-db.js for the
// full reasoning, identical here. Set BACKUP_DIR to a separate mounted
// volume, or pair this script with an off-box push run right after it
// exits 0.
const backupDir = process.env.BACKUP_DIR
  ? path.resolve(process.env.BACKUP_DIR)
  : path.join(ROOT_DIR, '../backups');

const RETENTION_DAYS = Number.parseInt(process.env.BACKUP_RETENTION_DAYS || '14', 10);

function timestampSuffix(date) {
  return date.toISOString().replace(/[:.]/g, '-');
}

async function main() {
  await fs.mkdir(backupDir, { recursive: true });

  const now = new Date();
  const destPath = path.join(backupDir, `console-${timestampSuffix(now)}.db`);

  console.log(`Backing up ${absoluteDbPath} -> ${destPath}`);
  const db = new Database(absoluteDbPath, { readonly: true });
  try {
    await db.backup(destPath);
  } finally {
    db.close();
  }

  // Verify before trusting - see casazium/license's matching script for
  // why this matters more than it might seem (a partial backup that
  // "succeeded" would only be discovered at restore time).
  const verifyDb = new Database(destPath, { readonly: true });
  let integrityResult;
  try {
    integrityResult = verifyDb.pragma('integrity_check', { simple: true });
  } finally {
    verifyDb.close();
  }
  if (integrityResult !== 'ok') {
    throw new Error(`Backup integrity check failed: ${integrityResult}`);
  }
  console.log('Backup integrity check passed.');

  // Matches the -shm/-wal sidecar files too, not just the .db itself -
  // same fix as casazium/license's own backup-db.js, same session. The
  // earlier pattern only matched the bare .db extension, so a backup's
  // SQLite WAL-mode sidecars (created when the verify step above
  // reopens the backup to run its integrity check) never got cleaned up
  // even after the .db they belonged to aged out and was deleted - an
  // unbounded local-disk leak, confirmed by finding several already
  // accumulated. Independently safe to prune each sidecar by its own
  // mtime: they're created within milliseconds of the .db file by the
  // same verify step, and are already inert by the time this prune
  // runs, since that step's own db.close() (in a finally block) has
  // long since released them.
  const cutoffMs = now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const entries = await fs.readdir(backupDir);
  let pruned = 0;
  for (const entry of entries) {
    if (!/^console-.*\.db(-shm|-wal)?$/.test(entry)) continue;
    const entryPath = path.join(backupDir, entry);
    const stat = await fs.stat(entryPath);
    if (stat.mtimeMs < cutoffMs) {
      await fs.unlink(entryPath);
      pruned++;
    }
  }
  if (pruned > 0) {
    console.log(`Pruned ${pruned} backup(s) older than ${RETENTION_DAYS} days.`);
  }

  console.log('Backup complete.');
}

main().catch((err) => {
  console.error('Backup failed:', err);
  process.exit(1);
});
