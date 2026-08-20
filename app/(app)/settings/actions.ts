'use server';

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { deleteAccount as deleteAccountOnServer } from '@/lib/license-client';
import { verifyAccountPassword } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { SESSION_COOKIE_NAME } from '@/lib/session';
import { requireSessionWithTenantKey, markIfTenantRejected } from '@/lib/tenant-context';
import { isRateLimited } from '@/lib/errors';

// No `ok: true` case - a resolved promise always means the delete
// didn't happen. On success this redirects (below) instead of
// returning, specifically to avoid a real bug: a client component that
// gets a plain return value back from a Server Action makes Next
// implicitly re-render the current route's Server Component tree
// afterward (normal behavior, so the page reflects whatever the action
// changed) - but by then the accounts row is gone and the session
// cookie is cleared, so /settings's own layout (requireSession())
// throws Unauthorized and its error boundary flashes on screen for a
// moment before the client's own navigation away takes over. Confirmed
// live (this is what that flash was) - reported directly by the
// operator testing the real deployed app, not caught by this session's
// own earlier verification pass, which saw the same console error and
// wrongly wrote it off as harmless noise. redirect() inside the action
// itself sidesteps this: it resolves to a navigation response directly,
// without Next ever attempting that in-between re-render.
type DeleteAccountFailure = { reason: 'rate-limited' | 'invalid-password' };

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
export async function deleteAccountAction(password: string): Promise<DeleteAccountFailure> {
  const { identity, tenantApiKey } = await requireSessionWithTenantKey();

  if (!identity.tenantId || !tenantApiKey) {
    // Unreachable via the UI - the delete-account section only renders
    // under MULTI_TENANT with a resolved tenant key (see the Settings
    // page). Defense in depth, not a real self-hosted path.
    throw new Error('Account deletion is only available for hosted accounts');
  }

  const passwordOk = await verifyAccountPassword(identity.id, password);
  if (!passwordOk) {
    return { reason: 'invalid-password' };
  }

  try {
    await deleteAccountOnServer(tenantApiKey);
  } catch (err) {
    if (isRateLimited(err)) return { reason: 'rate-limited' };
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

  redirect('/login');
}
