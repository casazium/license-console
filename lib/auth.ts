import type { Identity } from './session';

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

  if (username !== adminUsername || password !== adminPassword) {
    return null;
  }

  return { id: adminUsername, role: 'admin' };
}
