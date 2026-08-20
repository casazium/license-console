'use server';

import { cookies } from 'next/headers';
import { deleteAccount as deleteAccountOnServer } from '@/lib/license-client';
import { verifyAccountPassword } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { SESSION_COOKIE_NAME } from '@/lib/session';
import { requireSessionWithTenantKey, markIfTenantRejected } from '@/lib/tenant-context';
import { isRateLimited } from '@/lib/errors';

type DeleteAccountResult = { ok: true } | { ok: false; reason: 'rate-limited' | 'invalid-password' };

/**
 * Self-service hard account deletion (BETA_LAUNCH_STATUS.md §4).
 * Permanent, no grace period (operator decision, beta scope) - see
 * casazium/license's delete-tenant-account.js for the full data-purge
 * record on that side.
 *
 * Password re-entry, not just "click delete twice" (SettingsDangerZone's
 * confirm modal) - the same reasoning every real "type your password to
 * delete your account" flow uses: a left-open or hijacked session
 * shouldn't be enough on its own for something this permanent. Checked
 * here, server-side, via verifyAccountPassword() - not trusted from the
 * client.
 *
 * Order matters: the license-server side (license_keys, activations,
 * tenant_auth_log, billing_subscriptions, product_ownership, the tenant
 * row itself) is deleted first, and this console's own local rows only
 * after that succeeds - if the license-server call fails or is rate-
 * limited, the account stays fully intact on both sides rather than
 * this console silently forgetting an account that still has real data
 * server-side.
 *
 * No explicit session revocation call needed: deleting the accounts row
 * outright is the strongest possible revocation - lib/session.ts's
 * verifySessionToken() already rejects any token whose account no
 * longer exists at all, the same check that backs a stale/corrupted
 * token today. The cookie is cleared below purely so the browser stops
 * sending a token for an account that's gone, not because the session
 * would otherwise still work.
 */
export async function deleteAccountAction(password: string): Promise<DeleteAccountResult> {
  const { identity, tenantApiKey } = await requireSessionWithTenantKey();

  if (!identity.tenantId || !tenantApiKey) {
    // Unreachable via the UI - the delete-account section only renders
    // under MULTI_TENANT with a resolved tenant key (see the Settings
    // page). Defense in depth, not a real self-hosted path.
    throw new Error('Account deletion is only available for hosted accounts');
  }

  const passwordOk = await verifyAccountPassword(identity.id, password);
  if (!passwordOk) {
    return { ok: false, reason: 'invalid-password' };
  }

  try {
    await deleteAccountOnServer(tenantApiKey);
  } catch (err) {
    if (isRateLimited(err)) return { ok: false, reason: 'rate-limited' };
    markIfTenantRejected(err, identity.tenantId);
    throw err;
  }

  const db = getDb();
  const deleteLocalRows = db.transaction(() => {
    // No FK here, same reasoning as accounts.tenant_id itself (schema.sql)
    // - tenant identity is owned by casazium/license's own database, not
    // this one.
    db.prepare('DELETE FROM tenant_branding WHERE tenant_id = ?').run(identity.tenantId);
    // Cascades email_verification_tokens/password_reset_tokens (real FK,
    // ON DELETE CASCADE - schema.sql).
    db.prepare('DELETE FROM accounts WHERE id = ?').run(identity.id);
  });
  deleteLocalRows();

  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);

  return { ok: true };
}
