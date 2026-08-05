import { getDb } from './db';
import { decrypt } from './crypto';
import { requireSession, type Identity } from './session';
import { isTenantRejected } from './errors';

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
 * "Trigger 2" - a tenant revoked on casazium/license, cascading to every
 * console account under it. See lib/db/schema.sql's own comment on
 * accounts.tenant_revoked_at for the full design record and why this is
 * keyed by tenant_id (a `WHERE tenant_id = ?` cascade), not accountId -
 * today, under SaaS-B1b's one-account-per-tenant simplification, that's
 * exactly one row either way, but this is the version that stays correct
 * once that simplification is lifted, matching revokeAccountSessions's
 * own documented intent (lib/session.ts) for the same trigger.
 *
 * Called from two places: reactively, wherever a license-server call
 * surfaces the tenant's own rejection (lib/errors.ts's
 * isTenantRejected()), and at login time (app/api/login/route.ts's own
 * fresh probe against the license server).
 */
export function markTenantRevoked(tenantId: string): void {
  getDb().prepare('UPDATE accounts SET tenant_revoked_at = CURRENT_TIMESTAMP WHERE tenant_id = ?').run(tenantId);
}

/**
 * The shared call-site helper for the reactive half of trigger 2 -
 * every read page and Server Action that calls the license server (the
 * same set requireSessionWithTenantKey() below already unifies) calls
 * this in its existing catch block, alongside whatever else it already
 * checks (isRateLimited, etc.). A side effect only, not a different
 * control-flow branch - the caller's own existing `throw err` (or
 * `return { ok: false, ... }`) still runs unchanged right after this;
 * see markTenantRevoked()'s own comment for why the lockout doesn't
 * take effect until the account's next request.
 */
export function markIfTenantRejected(err: unknown, tenantId: string | undefined): void {
  if (isTenantRejected(err) && tenantId) {
    markTenantRevoked(tenantId);
  }
}

/**
 * Only used at login time (app/api/login/route.ts), before a session -
 * and therefore identity.tenantId (lib/session.ts) - exists yet.
 * Every other call site already has identity.tenantId directly from
 * requireSessionWithTenantKey() below and has no need for this.
 */
export function getAccountTenantId(accountId: string): string | null {
  const account = getDb().prepare('SELECT tenant_id FROM accounts WHERE id = ?').get(accountId) as
    | { tenant_id: string }
    | undefined;
  return account?.tenant_id ?? null;
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
