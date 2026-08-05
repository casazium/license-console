import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

/**
 * SaaS-B1a verification route - not wired into Coolify's own healthcheck
 * (docker-compose-coolify.yml still checks /login) since that's a
 * separate operational decision; this exists to prove the persistence
 * layer's connection lifecycle actually works end-to-end (dev HMR reuse,
 * the standalone build's native-binding + schema-file packaging) rather
 * than only in theory.
 */
export async function GET() {
  const db = getDb();
  const journalMode = db.pragma('journal_mode', { simple: true });
  const foreignKeys = db.pragma('foreign_keys', { simple: true });
  return NextResponse.json({ ok: true, journalMode, foreignKeys });
}
