import type { Identity } from './session';

/**
 * Today: a single shared admin password (ADMIN_UI_PASSWORD). Later: swap the
 * body of this function to check a real user store (this app's own DB, or a
 * new /v1/admin/login endpoint on casazium/license) and return per-user
 * identities - callers (the login route, session/middleware layer) don't
 * change. See PROJECT_STATUS.md §3.
 */
export async function verifyCredentials(password: string): Promise<Identity | null> {
  const adminPassword = process.env.ADMIN_UI_PASSWORD;
  if (!adminPassword) {
    throw new Error('Missing required environment variable: ADMIN_UI_PASSWORD');
  }

  if (password !== adminPassword) {
    return null;
  }

  return { id: 'admin', role: 'admin' };
}
