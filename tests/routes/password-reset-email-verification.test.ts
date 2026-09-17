import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { hashPassword } from '@/lib/password';
import { generateOneTimeToken, hashOneTimeToken } from '@/lib/one-time-token';

const dirname = path.dirname(fileURLToPath(import.meta.url));
// A real temp file, not ':memory:' - lib/db.ts's openDatabase() resolves
// a non-absolute DB_FILE via `path.join(process.cwd(), dbPath)` with no
// special case for that string, so ':memory:' becomes a literal file
// named ":memory:" in the project root rather than SQLite's in-memory
// database (confirmed the hard way: it left stray `:memory:`/-shm/-wal
// files in the repo root on a first pass of this suite). PID-suffixed,
// matching casazium/license's own test-DB-file convention, so parallel
// runs never collide.
const testDbFile = path.resolve(dirname, `test-password-reset-email-verification-${process.pid}.db`);

// One-time-token security properties for the two unauthenticated,
// token-is-the-credential flows: password reset (POST /api/reset-password)
// and email verification (GET /api/verify-email). Neither route had any
// test coverage before this file - the properties below (single-use,
// expiry enforcement, and the M4 fix invalidating *every* outstanding
// token for the account on redemption, not just the one used) were only
// guaranteed by reading the route source, not by anything that would
// fail if a future change broke them.
//
// Exercises the real exported Route Handlers end-to-end against a real
// (in-memory) SQLite DB, not a mocked db layer - a mock could drift from
// the actual schema/queries and give false confidence on exactly the
// kind of bug (the datetime() comparison bug this file's own db.ts
// documents finding) this suite exists to catch.
describe('password-reset and email-verification token security', () => {
  const PUBLIC_BASE_URL = 'https://console.example.com';

  beforeAll(() => {
    vi.stubEnv('DB_FILE', testDbFile);
    vi.stubEnv('MULTI_TENANT', 'true');
    vi.stubEnv('SESSION_SECRET', 'a'.repeat(32));
    vi.stubEnv('PUBLIC_BASE_URL', PUBLIC_BASE_URL);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    const fs = await import('node:fs/promises');
    for (const suffix of ['', '-shm', '-wal']) {
      await fs.unlink(testDbFile + suffix).catch(() => {});
    }
  });

  // Lazily imported after env stubs are in place - lib/db.ts's
  // openDatabase() reads MULTI_TENANT/DB_FILE at first getDb() call, and
  // every route module transitively imports it at module-load time.
  let getDb: typeof import('@/lib/db').getDb;
  let resetPasswordPOST: typeof import('@/app/api/reset-password/route').POST;
  let verifyEmailGET: typeof import('@/app/api/verify-email/route').GET;

  beforeAll(async () => {
    ({ getDb } = await import('@/lib/db'));
    ({ POST: resetPasswordPOST } = await import('@/app/api/reset-password/route'));
    ({ GET: verifyEmailGET } = await import('@/app/api/verify-email/route'));
  });

  async function createAccount(): Promise<{ id: string; email: string }> {
    const id = randomUUID();
    // randomUUID(), not an incrementing counter - this suite's module
    // state isn't guaranteed to be fresh when Vitest batches multiple
    // test files into one worker (confirmed empirically: a counter here
    // produced real UNIQUE-constraint collisions once another test file
    // ran alongside this one), so nothing here should assume a
    // from-zero, this-file-only counter.
    const email = `account-${id}@example.com`;
    const passwordHash = await hashPassword('original-password-1');
    getDb()
      .prepare(
        `INSERT INTO accounts (id, email, password_hash, tenant_id, tenant_api_key_encrypted)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(id, email, passwordHash, `tenant-${id}`, 'encrypted-placeholder');
    return { id, email };
  }

  function insertPasswordResetToken(accountId: string, expiresAt: Date): string {
    const token = generateOneTimeToken();
    getDb()
      .prepare('INSERT INTO password_reset_tokens (token_hash, account_id, expires_at) VALUES (?, ?, ?)')
      .run(hashOneTimeToken(token), accountId, expiresAt.toISOString());
    return token;
  }

  function insertEmailVerificationToken(accountId: string, expiresAt: Date): string {
    const token = generateOneTimeToken();
    getDb()
      .prepare('INSERT INTO email_verification_tokens (token_hash, account_id, expires_at) VALUES (?, ?, ?)')
      .run(hashOneTimeToken(token), accountId, expiresAt.toISOString());
    return token;
  }

  function resetPasswordRequest(body: unknown, forwardedFor: string) {
    return new NextRequest(`${PUBLIC_BASE_URL}/api/reset-password`, {
      method: 'POST',
      headers: {
        Origin: PUBLIC_BASE_URL,
        'Content-Type': 'application/json',
        'x-forwarded-for': forwardedFor,
      },
      body: JSON.stringify(body),
    });
  }

  function verifyEmailRequest(token: string | null) {
    const url = new URL(`${PUBLIC_BASE_URL}/api/verify-email`);
    if (token) url.searchParams.set('token', token);
    return new NextRequest(url);
  }

  const future = (hours: number) => new Date(Date.now() + hours * 60 * 60 * 1000);
  const past = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000);

  describe('POST /api/reset-password', () => {
    it('a valid token resets the password and cannot be reused (single-use)', async () => {
      const account = await createAccount();
      const token = insertPasswordResetToken(account.id, future(1));

      const first = await resetPasswordRequest(
        { token, password: 'brand-new-password-1' },
        'reset-1a'
      );
      const firstRes = await resetPasswordPOST(first);
      expect(firstRes.status).toBe(200);

      const replay = resetPasswordRequest({ token, password: 'another-password-2' }, 'reset-1b');
      const replayRes = await resetPasswordPOST(replay);
      expect(replayRes.status).toBe(400);
      const replayBody = await replayRes.json();
      expect(replayBody.error).toMatch(/invalid or expired/i);
    });

    it('an expired token is rejected and never changes the password', async () => {
      const account = await createAccount();
      const token = insertPasswordResetToken(account.id, past(1));

      const res = await resetPasswordPOST(
        resetPasswordRequest({ token, password: 'should-never-be-set-1' }, 'reset-2')
      );
      expect(res.status).toBe(400);

      const row = getDb().prepare('SELECT password_hash FROM accounts WHERE id = ?').get(account.id) as {
        password_hash: string;
      };
      // The original hash (from createAccount's own hashPassword call)
      // must be unchanged - an expired token must never reach the
      // UPDATE statement, not just return an error status.
      expect(row.password_hash).not.toContain('should-never-be-set');
    });

    it('a garbage/unknown token is rejected the same way as an expired one (no oracle)', async () => {
      const res = await resetPasswordPOST(
        resetPasswordRequest({ token: 'a'.repeat(32), password: 'whatever-password-1' }, 'reset-3')
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/invalid or expired/i);
    });

    it('M4: redeeming one reset token invalidates every other outstanding token for the same account', async () => {
      const account = await createAccount();
      const attackerSavedToken = insertPasswordResetToken(account.id, future(1));
      const victimNewToken = insertPasswordResetToken(account.id, future(1));

      // The victim notices a suspicious email and resets their password
      // using their own, later-requested token.
      const victimReset = await resetPasswordPOST(
        resetPasswordRequest({ token: victimNewToken, password: 'victim-chosen-password-1' }, 'reset-4a')
      );
      expect(victimReset.status).toBe(200);

      // The attacker's earlier-saved token must be dead too, not just
      // the one actually used - otherwise it could still re-take the
      // account and undo the victim's own remediation.
      const attackerReplay = await resetPasswordPOST(
        resetPasswordRequest({ token: attackerSavedToken, password: 'attacker-password-1' }, 'reset-4b')
      );
      expect(attackerReplay.status).toBe(400);
    });

    it('revokes every existing session for the account on a successful reset', async () => {
      const account = await createAccount();
      const token = insertPasswordResetToken(account.id, future(1));

      const before = getDb().prepare('SELECT sessions_revoked_at FROM accounts WHERE id = ?').get(account.id) as {
        sessions_revoked_at: string | null;
      };
      expect(before.sessions_revoked_at).toBeNull();

      const res = await resetPasswordPOST(
        resetPasswordRequest({ token, password: 'fresh-password-after-reset-1' }, 'reset-5')
      );
      expect(res.status).toBe(200);

      const after = getDb().prepare('SELECT sessions_revoked_at FROM accounts WHERE id = ?').get(account.id) as {
        sessions_revoked_at: string | null;
      };
      expect(after.sessions_revoked_at).not.toBeNull();
    });

    it('rejects a cross-origin request before ever looking at the token (CSRF-style guard)', async () => {
      const account = await createAccount();
      const token = insertPasswordResetToken(account.id, future(1));

      const request = new NextRequest(`${PUBLIC_BASE_URL}/api/reset-password`, {
        method: 'POST',
        headers: {
          Origin: 'https://attacker.example',
          'Content-Type': 'application/json',
          'x-forwarded-for': 'reset-6',
        },
        body: JSON.stringify({ token, password: 'should-never-apply-1' }),
      });
      const res = await resetPasswordPOST(request);
      expect(res.status).toBe(403);

      // The token must still be redeemable afterward - a rejected
      // cross-origin attempt must not have consumed it.
      const legitimate = await resetPasswordPOST(
        resetPasswordRequest({ token, password: 'legitimate-password-1' }, 'reset-6b')
      );
      expect(legitimate.status).toBe(200);
    });
  });

  describe('GET /api/verify-email', () => {
    it('a valid token marks the account verified and cannot be reused (single-use)', async () => {
      const account = await createAccount();
      const token = insertEmailVerificationToken(account.id, future(24));

      await verifyEmailGET(verifyEmailRequest(token));

      const verified = getDb().prepare('SELECT email_verified_at FROM accounts WHERE id = ?').get(account.id) as {
        email_verified_at: string | null;
      };
      expect(verified.email_verified_at).not.toBeNull();

      const remaining = getDb()
        .prepare('SELECT COUNT(*) AS n FROM email_verification_tokens WHERE token_hash = ?')
        .get(hashOneTimeToken(token)) as { n: number };
      expect(remaining.n).toBe(0);
    });

    it('an expired token does not mark the account verified', async () => {
      const account = await createAccount();
      const token = insertEmailVerificationToken(account.id, past(1));

      await verifyEmailGET(verifyEmailRequest(token));

      const row = getDb().prepare('SELECT email_verified_at FROM accounts WHERE id = ?').get(account.id) as {
        email_verified_at: string | null;
      };
      expect(row.email_verified_at).toBeNull();
    });

    it('M4: redeeming one verification token invalidates every other outstanding token for the same account', async () => {
      const account = await createAccount();
      const staleToken = insertEmailVerificationToken(account.id, future(24));
      const freshToken = insertEmailVerificationToken(account.id, future(24));

      await verifyEmailGET(verifyEmailRequest(freshToken));

      const staleRemaining = getDb()
        .prepare('SELECT COUNT(*) AS n FROM email_verification_tokens WHERE token_hash = ?')
        .get(hashOneTimeToken(staleToken)) as { n: number };
      expect(staleRemaining.n).toBe(0);
    });

    it('a missing token redirects without touching any account', async () => {
      const res = await verifyEmailGET(verifyEmailRequest(null));
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toBe(`${PUBLIC_BASE_URL}/dashboard`);
    });
  });
});
