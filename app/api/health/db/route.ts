import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

/**
 * SaaS-B1a verification route, originally built to prove the
 * persistence layer's connection lifecycle actually works end-to-end
 * (dev HMR reuse, the standalone build's native-binding + schema-file
 * packaging) rather than only in theory - and now also this repo's real
 * health check (BETA_LAUNCH_STATUS.md §4): wired into Coolify's own
 * container healthcheck in place of /login, which never touched the
 * database at all.
 *
 * The two pragma reads below don't guarantee a real page read from the
 * database file - added the SELECT explicitly so a locked or corrupted
 * DB reliably throws here, the same reasoning casazium/license's own
 * new GET /health route documents for its equivalent
 * `SELECT 1 FROM sqlite_master` check.
 */
export async function GET() {
  try {
    const db = getDb();
    const journalMode = db.pragma('journal_mode', { simple: true });
    const foreignKeys = db.pragma('foreign_keys', { simple: true });
    db.prepare('SELECT 1 FROM sqlite_master LIMIT 1').get();
    return NextResponse.json({ ok: true, journalMode, foreignKeys });
  } catch (err) {
    console.error('Health check: database query failed', err);
    return NextResponse.json({ ok: false, error: 'Database check failed' }, { status: 503 });
  }
}
