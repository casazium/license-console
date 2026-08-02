import { timingSafeEqual } from 'node:crypto';
import type { Identity } from './session';

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
 * Today: a single shared admin username/password (ADMIN_UI_USERNAME /
 * ADMIN_UI_PASSWORD) - not real multi-account, just a configured display
 * identity. Later: swap the body of this function to check a real user
 * store (this app's own DB, or a new /v1/admin/login endpoint on
 * casazium/license) and return per-user identities - callers (the login
 * route, session/middleware layer) don't change. See PROJECT_STATUS.md §9.
 */
export async function verifyCredentials(username: string, password: string): Promise<Identity | null> {
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
