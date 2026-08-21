'use server';

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { deleteAccount as deleteAccountOnServer, rotateApiKey as rotateApiKeyOnServer } from '@/lib/license-client';
import { verifyAccountPassword } from '@/lib/auth';
import { encrypt } from '@/lib/crypto';
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

// BETA_LAUNCH_STATUS.md §4, API-key-rotation gap: no self-service
// recovery existed for a leaked tenant key - the only options were
// asking the operator to intervene manually, or deleting the whole
// account via deleteAccountAction above and re-issuing every license
// from scratch.
// localSyncFailed is set only on the success path - the license-server
// rotation itself succeeded (the caller has a real, working new key),
// but this console's own local copy could not be persisted (see the
// try/catch around the UPDATE below). Kept a separate flag rather than
// folded into the failure union, since this is not a failure the caller
// should retry - retrying would just rotate again.
type RotateApiKeyResult =
  | { apiKey: string; localSyncFailed?: boolean }
  | { reason: 'rate-limited' | 'invalid-password' };

/**
 * Rotates the tenant's own API key on casazium/license (hard cutover -
 * the old key stops authenticating immediately, see that repo's
 * rotate-own-api-key.js), then re-encrypts the returned plaintext key
 * into this console's own accounts.tenant_api_key_encrypted - without
 * this second step, the console's own stored copy (every Server Action
 * in this app that calls the license server, plus the Settings page's
 * own ApiKeyReveal display) would go stale the instant rotation
 * succeeds, since nothing else keeps the two databases' copies in sync.
 *
 * Password re-entry, same reasoning as deleteAccountAction above: a
 * left-open or hijacked session shouldn't be enough on its own to
 * invalidate every credential this tenant's own backend is currently
 * using. Checked server-side via verifyAccountPassword(), not trusted
 * from the client.
 *
 * Returns the new plaintext key directly (rather than relying on the
 * Settings page re-rendering) so the UI can show a clear "here's your
 * new key, update your systems now" moment - the same one-time-reveal
 * framing signup already uses, even though this console does persist a
 * decryptable copy afterward (ApiKeyReveal on Settings can show it
 * again later, unlike a true show-once secret).
 *
 * Security review finding: the license-server rotation and this
 * console's own local persist are two separate steps, not one
 * transaction - if the local UPDATE below fails after the
 * license-server side already succeeded, the caller must still get the
 * new key back (it's the only real, working credential at that point;
 * losing it here would mean a successful rotation the tenant can never
 * see, with every other Server Action in this app then silently
 * breaking against the console's now-stale stored copy). The UPDATE is
 * therefore in its own try/catch, not the outer one - a failure there
 * sets localSyncFailed instead of throwing.
 */
export async function rotateApiKeyAction(password: string): Promise<RotateApiKeyResult> {
  const { identity, tenantApiKey } = await requireSessionWithTenantKey();

  if (!identity.tenantId || !tenantApiKey) {
    // Unreachable via the UI - the rotate-key section only renders under
    // MULTI_TENANT with a resolved tenant key (see the Settings page).
    // Defense in depth, not a real self-hosted path.
    throw new Error('API key rotation is only available for hosted accounts');
  }

  const passwordOk = await verifyAccountPassword(identity.id, password);
  if (!passwordOk) {
    return { reason: 'invalid-password' };
  }

  let newApiKey: string;
  try {
    ({ apiKey: newApiKey } = await rotateApiKeyOnServer(tenantApiKey));
  } catch (err) {
    if (isRateLimited(err)) return { reason: 'rate-limited' };
    markIfTenantRejected(err, identity.tenantId);
    throw err;
  }

  // The license-server side has already rotated at this point - this
  // local update is a best-effort sync, not part of that transaction.
  // A failure here must not lose the key: it's returned to the caller
  // either way (see the function's own doc comment above).
  try {
    const db = getDb();
    db.prepare('UPDATE accounts SET tenant_api_key_encrypted = ? WHERE id = ?').run(
      encrypt(newApiKey),
      identity.id
    );
  } catch (err) {
    console.error('Failed to persist rotated API key locally after a successful rotation:', err);
    return { apiKey: newApiKey, localSyncFailed: true };
  }

  return { apiKey: newApiKey };
}
