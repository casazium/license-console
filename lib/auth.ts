import { timingSafeEqual } from 'node:crypto';
import type { Identity } from './session';
import { isMultiTenant } from './config';
import { getDb } from './db';
import { verifyPassword, DUMMY_PASSWORD_HASH } from './password';

// Fixed, non-secret decoy hash (security review finding M1) - exists
// only so verifyCredentials() below can run a real scrypt computation
// against *something* when no account matches, rather than returning
// immediately. Measured ~8x faster for a nonexistent email than an
// existing one before this, since scrypt was skipped entirely - a
// remotely-measurable way to enumerate registered accounts. Imported
// from lib/password.ts, not redefined here (security review finding,
// third-party audit, R3-CONSOLE-M2) - password.ts's own stored format
// changed to embed cost parameters, and a hand-duplicated literal here
// would have silently stopped matching that format, making this decoy
// fail decodeHash()'s parse and return false *before* ever running
// scrypt - reintroducing the exact timing side-channel this constant
// exists to close.

/**
 * Security review finding (fresh pre-deployment audit): email lookups
 * and inserts used the raw, case-sensitive string - SQLite's `=` on
 * TEXT is case-sensitive, so 'Alice@x.com' and 'alice@x.com' were two
 * different accounts backed by the same real mailbox, each provisioning
 * a separate real tenant on the license server. Confirmed live: signing
 * up 'alice@example.com' then 'Alice@example.com' both succeeded as
 * distinct accounts. Worse, it caused silent permanent lockout - a user
 * who signs up as 'Bob@corp.com' and later types 'bob@corp.com' gets
 * "Invalid username or password", and forgot-password's own SELECT
 * misses too (generic success shown, but no email ever sent).
 *
 * Applied at every read and write site (this function, signup,
 * forgot-password) - not left to `lib/db/schema.sql`'s own
 * `COLLATE NOCASE` alone, which only handles case, not stray
 * whitespace, and is meant as the defense-in-depth backstop, not the
 * sole mechanism.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

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
      .get(normalizeEmail(username)) as { id: string; password_hash: string } | undefined;

    // Always pay the same scrypt cost, account or not (see
    // DUMMY_PASSWORD_HASH above) - checking `!account` first and
    // returning immediately, as this used to, is a real, remotely
    // measurable timing side-channel.
    const passwordMatches = await verifyPassword(password, account?.password_hash ?? DUMMY_PASSWORD_HASH);
    if (!account || !passwordMatches) {
      return null;
    }
    return { id: account.id, role: 'admin', mode: 'saas' };
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

  return { id: adminUsername, role: 'admin', mode: 'selfhosted' };
}

/**
 * Re-authentication check for the destructive account-deletion confirm
 * step (BETA_LAUNCH_STATUS.md §4) - proves the person driving the
 * already-authenticated session still knows the account password, the
 * same reasoning every "type your password to delete your account" flow
 * uses (a left-open session or a hijacked one shouldn't be enough on its
 * own for a permanent, unrecoverable action). Deliberately looked up by
 * accountId, not verifyCredentials()'s username+password shape - the
 * caller already has a verified session's account id and has no reason
 * to know or re-collect the email. SaaS-only, same as verifyCredentials'
 * own SaaS branch - self-hosted's single shared admin login has no
 * accounts row to check and never reaches this (its own delete-account
 * button never renders - see the Settings page).
 */
export async function verifyAccountPassword(accountId: string, password: string): Promise<boolean> {
  const account = getDb()
    .prepare('SELECT password_hash FROM accounts WHERE id = ?')
    .get(accountId) as { password_hash: string } | undefined;

  return verifyPassword(password, account?.password_hash ?? DUMMY_PASSWORD_HASH);
}
