import { getDb } from './db';
import { decrypt } from './crypto';
import { requireSession, type Identity } from './session';

/**
 * SaaS-B2. Resolves the current account's tenant API key for use against
 * casazium/license, decrypting SaaS-B1b's `accounts.tenant_api_key_encrypted`
 * on demand rather than caching the plaintext anywhere - called once per
 * page render or Server Action, then threaded explicitly through the
 * license-client dispatcher calls that need it, not re-resolved per call.
 */
export function getTenantApiKey(accountId: string): string {
  const account = getDb()
    .prepare('SELECT tenant_api_key_encrypted FROM accounts WHERE id = ?')
    .get(accountId) as { tenant_api_key_encrypted: string } | undefined;

  if (!account) {
    // Should be unreachable - requireSession() already rejects a token
    // whose account no longer exists (lib/session.ts) - but fail loud
    // rather than let a decrypt() call below throw a less legible error.
    throw new Error(`No account found for id ${accountId}`);
  }

  return decrypt(account.tenant_api_key_encrypted);
}

/**
 * SaaS-B5. The "Company / organization" name collected (and previously
 * discarded) at signup, for the onboarding flow's welcome copy - see
 * lib/db/schema.sql's accounts.tenant_name comment for why this lives
 * here rather than being fetched from casazium/license.
 */
export function getTenantName(accountId: string): string | null {
  const account = getDb().prepare('SELECT tenant_name FROM accounts WHERE id = ?').get(accountId) as
    | { tenant_name: string | null }
    | undefined;
  return account?.tenant_name ?? null;
}

/**
 * The actual call-site helper (SaaS-B2's 4 real call sites - actions.ts's
 * 5 actions, and the 3 read pages - all need exactly this pair of steps).
 * Factored out deliberately, not left as 8 near-identical inline copies:
 * F8's own warning was that one missed/wrong call site silently operates
 * as the cross-tenant superuser, and a shared helper is what makes that
 * auditable in one place instead of trusting 8 sites to stay consistent.
 * Under self-hosted (`identity.tenantId` unset), `tenantApiKey` is
 * `undefined` and every downstream call behaves exactly as it did before
 * this task.
 */
export async function requireSessionWithTenantKey(): Promise<{
  identity: Identity;
  tenantApiKey?: string;
}> {
  const identity = await requireSession();
  const tenantApiKey = identity.tenantId ? getTenantApiKey(identity.id) : undefined;
  return { identity, tenantApiKey };
}
