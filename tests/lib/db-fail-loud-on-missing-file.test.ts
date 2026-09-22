import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dirname = path.dirname(fileURLToPath(import.meta.url));
// Each case gets its own file - the "throws" case must never leave a
// file behind (fileMustExist:true means better-sqlite3 refuses to
// create one at all), but sharing one path across cases would still
// make the other two cases' "file was missing" premise depend on
// execution order rather than each being independently true.
const dbFileFor = (name: string) => path.resolve(dirname, `test-db-fail-loud-${name}-${process.pid}.db`);
const allTestDbFiles = ['throws', 'allow-init', 'self-hosted'].map(dbFileFor);

// Real production incident, not hypothetical: a restart of the SaaS-tier
// resource hit a missing console.db and, with no guard on the
// `new Database()` call in lib/db.ts, better-sqlite3 silently created a
// fresh empty file, which the schema's own CREATE TABLE IF NOT EXISTS
// then populated cleanly - the app booted looking perfectly healthy
// while every account was gone, with nothing in the logs to say so.
// This suite exercises the fix (fileMustExist under MULTI_TENANT=true,
// gated by an explicit DB_ALLOW_INIT opt-in) directly, since it's the
// one piece of this codebase where a silent regression means real data
// loss rather than a failed test.
describe('lib/db.ts fails loud on a missing file under MULTI_TENANT=true', () => {
  beforeEach(() => {
    vi.resetModules();
    // getDb()'s singleton lives on globalThis, not module-local state -
    // vi.resetModules() alone doesn't clear it, so a stale connection
    // from a previous case in this file would otherwise leak across
    // stubbed env changes.
    delete (globalThis as Record<string, unknown>).__consoleDb;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    const fs = await import('node:fs/promises');
    for (const file of allTestDbFiles) {
      for (const suffix of ['', '-shm', '-wal']) {
        await fs.unlink(file + suffix).catch(() => {});
      }
    }
  });

  it('throws rather than silently creating an empty database when MULTI_TENANT=true and the file is missing', async () => {
    vi.stubEnv('MULTI_TENANT', 'true');
    vi.stubEnv('DB_FILE', dbFileFor('throws'));
    vi.stubEnv('DB_ALLOW_INIT', '');

    const { getDb } = await import('@/lib/db');
    expect(() => getDb()).toThrow(/unable to open database file/i);
  });

  it('creates a fresh database when MULTI_TENANT=true and DB_ALLOW_INIT=true is explicitly set', async () => {
    vi.stubEnv('MULTI_TENANT', 'true');
    vi.stubEnv('DB_FILE', dbFileFor('allow-init'));
    vi.stubEnv('DB_ALLOW_INIT', 'true');

    const { getDb } = await import('@/lib/db');
    const db = getDb();
    const accountCount = (db.prepare('SELECT COUNT(*) AS n FROM accounts').get() as { n: number }).n;
    expect(accountCount).toBe(0);
  });

  it('still auto-creates a missing file under self-hosted (MULTI_TENANT unset), regardless of DB_ALLOW_INIT', async () => {
    vi.stubEnv('MULTI_TENANT', '');
    vi.stubEnv('DB_FILE', dbFileFor('self-hosted'));
    vi.stubEnv('DB_ALLOW_INIT', '');

    const { getDb } = await import('@/lib/db');
    expect(() => getDb()).not.toThrow();
  });
});
