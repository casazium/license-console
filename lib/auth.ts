import { timingSafeEqual } from 'node:crypto';
import type { Identity } from './session';
import { isMultiTenant } from './config';
import { getDb } from './db';
import { verifyPassword } from './password';

// Fixed, non-secret salt:hashHex shape (security review finding M1) -
// exists only so verifyCredentials() below can run a real scrypt
// computation against *something* when no account matches, rather than
// returning immediately. Measured ~8x faster for a nonexistent email
// than an existing one before this, since scrypt was skipped entirely -
// a remotely-measurable way to enumerate registered accounts. The
// actual bytes don't matter (this is never a real password's hash,
// just a fixed-cost decoy), only that verifyPassword's own `!salt ||
// !hashHex` guard doesn't short-circuit it too.
const DUMMY_PASSWORD_HASH = `${'0'.repeat(32)}:${'0'.repeat(128)}`;

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // Length must match before timingSafeEqual (it throws on mismatched
  // lengths) - unavoidable minor leak of length via early return, but that's
  // a much smaller signal than a plain !== comparison, which leaks equality
  // up to the first differing byte.
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/**
 * Self-hosted (MULTI_TENANT unset, the default): a single shared admin
 * username/password (ADMIN_UI_USERNAME / ADMIN_UI_PASSWORD) - not real
 * multi-account, just a configured display identity. Untouched by
 * SaaS-B1b - a self-hosted deployment has exactly one operator, and
 * signup/accounts would be pure overhead for it. See PROJECT_STATUS.md §9
 * for why this shape was chosen originally.
 *
 * SaaS mode (MULTI_TENANT=true): checks the accounts table instead
 * (SaaS-B1b). `username` here is the account's email.
 */
export async function verifyCredentials(username: string, password: string): Promise<Identity | null> {
  if (isMultiTenant()) {
    const account = getDb()
      .prepare('SELECT id, password_hash FROM accounts WHERE email = ?')
      .get(username) as { id: string; password_hash: string } | undefined;

    // Always pay the same scrypt cost, account or not (see
    // DUMMY_PASSWORD_HASH above) - checking `!account` first and
    // returning immediately, as this used to, is a real, remotely
    // measurable timing side-channel.
    const passwordMatches = await verifyPassword(password, account?.password_hash ?? DUMMY_PASSWORD_HASH);
    if (!account || !passwordMatches) {
      return null;
    }
    return { id: account.id, role: 'admin' };
  }

  const adminUsername = process.env.ADMIN_UI_USERNAME;
  const adminPassword = process.env.ADMIN_UI_PASSWORD;
  if (!adminUsername || !adminPassword) {
    throw new Error('Missing required environment variable: ADMIN_UI_USERNAME or ADMIN_UI_PASSWORD');
  }

  const usernameMatches = constantTimeEquals(username, adminUsername);
  const passwordMatches = constantTimeEquals(password, adminPassword);
  if (!usernameMatches || !passwordMatches) {
    return null;
  }

  return { id: adminUsername, role: 'admin' };
}
