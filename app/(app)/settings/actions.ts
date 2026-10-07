'use server';

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import {
  deleteAccount as deleteAccountOnServer,
  rotateApiKey as rotateApiKeyOnServer,
  createStorefrontWebhook as createStorefrontWebhookOnServer,
  setStorefrontWebhookSecret as setStorefrontWebhookSecretOnServer,
  setStorefrontRefundPolicy as setStorefrontRefundPolicyOnServer,
  setStorefrontSubscriptionGrace as setStorefrontSubscriptionGraceOnServer,
  disableStorefrontWebhook as disableStorefrontWebhookOnServer,
  listStorefrontMappings as listStorefrontMappingsOnServer,
  createStorefrontMapping as createStorefrontMappingOnServer,
  deleteStorefrontMapping as deleteStorefrontMappingOnServer,
  listStorefrontDeliveries as listStorefrontDeliveriesOnServer,
} from '@/lib/license-client';
import type {
  CreateStorefrontMappingInput,
  ListStorefrontDeliveriesResult,
  StorefrontMapping,
  StorefrontWebhook,
  StorefrontWebhookProvider,
  StorefrontRefundPolicy,
} from '@/lib/license-client';
import { verifyAccountPassword } from '@/lib/auth';
import { encrypt } from '@/lib/crypto';
import { hashPassword } from '@/lib/password';
import { getDb } from '@/lib/db';
import {
  SESSION_COOKIE_NAME,
  createSessionToken,
  revokeAccountSessions,
  requireSession,
  sessionCookieOptions,
} from '@/lib/session';
import { requireSessionWithTenantKey, markIfTenantRejected } from '@/lib/tenant-context';
import { isRateLimited } from '@/lib/errors';
import { getNotificationProvider } from '@/lib/notifications';

// Same values and reasoning as signup/route.ts and reset-password/route.ts's
// identical constants - no shared constants module in this codebase
// (each of those two also redefines its own copy), so matching their
// convention rather than introducing a new one here.
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 256;

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
 * tenant_auth_log, billing_subscriptions, products, the tenant row
 * itself) is deleted first, and this console's own local rows only
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

  // Operator notification (TASK_ACCOUNT_NOTIFICATIONS.md) - fire-and-
  // forget, must not block or fail this redirect. Deliberately the
  // opaque account id only, never the email - see provider.ts's own doc
  // comment: a plaintext email in a permanent Discord message would
  // outlive this app's "permanently deleted, cannot be recovered"
  // promise for hosted accounts. Fired after deleteLocalRows() commits
  // (both the license-server-side and local deletions have already
  // succeeded by this point - deleteAccountOnServer above throws on
  // failure, so this line is only reached on a real, complete deletion).
  getNotificationProvider()
    .notify({ type: 'account.deleted', accountId: identity.id })
    .catch((err) => {
      console.error(`Failed to send account.deleted notification for account ${identity.id}:`, err);
    });

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

// BETA_LAUNCH_STATUS.md §4, account-settings gap: there was no way to
// change a password while logged in at all - the only self-service path
// to a new password was forgot-password, which requires being logged
// OUT and proving control of the account's email first. This is the
// ordinary in-session case (you know your current password and just
// want a new one), and unlike deleteAccountAction/rotateApiKeyAction
// above, it's entirely local to this console's own accounts table - no
// casazium/license call, no dual-database non-atomicity to design
// around, since a password only ever exists here.
type ChangePasswordResult =
  | { ok: true }
  | { reason: 'incorrect-current-password' | 'invalid-new-password' };

/**
 * Password re-entry, same reasoning as deleteAccountAction/
 * rotateApiKeyAction above: a left-open or hijacked session shouldn't
 * be enough on its own to set a new password - the caller must still
 * prove they know the current one.
 *
 * On success: revokes every other session for the account and reissues
 * a fresh one for the browser completing this change, mirroring
 * app/api/reset-password/route.ts's identical, already-battle-tested
 * pattern exactly (that route's own comment: "a stolen or leaked
 * session shouldn't survive a legitimate password reset"). The
 * difference from that route is only how the person got here - proving
 * they know the *current* password in an active session, vs. proving
 * control of the account's email via a one-time link - the outcome and
 * its reasoning are identical.
 */
export async function changePasswordAction(
  currentPassword: string,
  newPassword: string
): Promise<ChangePasswordResult> {
  const identity = await requireSession();

  if (!identity.tenantId) {
    // Unreachable via the UI - the change-password section only renders
    // under MULTI_TENANT with a resolved tenant (see the Settings page).
    // Defense in depth, not a real self-hosted path - self-hosted's
    // single shared admin login has no accounts row to change a
    // password on at all.
    throw new Error('Password change is only available for hosted accounts');
  }

  if (newPassword.length < MIN_PASSWORD_LENGTH || newPassword.length > MAX_PASSWORD_LENGTH) {
    return { reason: 'invalid-new-password' };
  }

  const passwordOk = await verifyAccountPassword(identity.id, currentPassword);
  if (!passwordOk) {
    return { reason: 'incorrect-current-password' };
  }

  const newPasswordHash = await hashPassword(newPassword);
  const db = getDb();
  db.prepare('UPDATE accounts SET password_hash = ? WHERE id = ?').run(newPasswordHash, identity.id);

  revokeAccountSessions(identity.id);
  const sessionToken = await createSessionToken({ id: identity.id, role: 'admin', mode: 'saas' });
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, sessionToken, sessionCookieOptions);

  return { ok: true };
}

// STOREFRONT_WEBHOOK_PLAN.md - Server Actions backing StorefrontWebhooksSection.
//
// Two result shapes, matching the two distinct failure profiles among
// these calls (same reasoning as billing/actions.ts's own single
// ActionResult<T>, split in two here since two of these calls have a
// second, genuinely distinct failure mode worth telling apart from an
// opaque "something went wrong"):
// - SimpleActionResult: the only realistic failure is a 429 - true for
//   every list/disable/delete call, since a 404 there ("that
//   webhook/mapping no longer exists") is already handled as a normal
//   `false`/`[]` return by the client functions themselves, not an error.
// - ValidatedActionResult: createStorefrontWebhookAction (409, an active
//   webhook already exists; 400, a server too old for the provider),
//   setStorefrontWebhookSecretAction (400, a Lemon Squeezy secret outside
//   16-40 characters) and createStorefrontMappingAction (400 from
//   validateLicenseLimits.js or a ref kind the provider doesn't use, or
//   409, a duplicate mapping reference) can all fail on genuinely
//   retryable-with-different-input user error -
//   the server's own message text is safe to show verbatim here (unlike
//   a buyer-facing surface, every message on this admin-only CRUD
//   describes the tenant's own configuration mistake back to them).
type SimpleActionResult<T> = { ok: true; data: T } | { ok: false; reason: 'rate-limited' };
type ValidatedActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'rate-limited' }
  | { ok: false; reason: 'validation'; message: string };

export async function createStorefrontWebhookAction(
  provider: StorefrontWebhookProvider
): Promise<ValidatedActionResult<StorefrontWebhook>> {
  const { identity, tenantApiKey } = await requireSessionWithTenantKey();
  try {
    const data = await createStorefrontWebhookOnServer(provider, tenantApiKey);
    return { ok: true, data };
  } catch (err) {
    if (isRateLimited(err)) return { ok: false, reason: 'rate-limited' };
    markIfTenantRejected(err, identity.tenantId);
    if (err instanceof Error) return { ok: false, reason: 'validation', message: err.message };
    throw err;
  }
}

export async function setStorefrontWebhookSecretAction(
  webhookId: string,
  secret: string
): Promise<ValidatedActionResult<boolean>> {
  const { identity, tenantApiKey } = await requireSessionWithTenantKey();
  try {
    const data = await setStorefrontWebhookSecretOnServer(webhookId, secret, tenantApiKey);
    return { ok: true, data };
  } catch (err) {
    if (isRateLimited(err)) return { ok: false, reason: 'rate-limited' };
    markIfTenantRejected(err, identity.tenantId);
    if (err instanceof Error) return { ok: false, reason: 'validation', message: err.message };
    throw err;
  }
}

// What a full refund does on this webhook (License Server 1.8.0+). A
// validation failure here is an older server without the route.
export async function setStorefrontRefundPolicyAction(
  webhookId: string,
  refundPolicy: StorefrontRefundPolicy
): Promise<ValidatedActionResult<boolean>> {
  const { identity, tenantApiKey } = await requireSessionWithTenantKey();
  try {
    const data = await setStorefrontRefundPolicyOnServer(webhookId, refundPolicy, tenantApiKey);
    return { ok: true, data };
  } catch (err) {
    if (isRateLimited(err)) return { ok: false, reason: 'rate-limited' };
    markIfTenantRejected(err, identity.tenantId);
    if (err instanceof Error) return { ok: false, reason: 'validation', message: err.message };
    throw err;
  }
}

// How long a subscription's license stays valid past its paid period
// (License Server 1.9.0+). Checked here too, so a bad value never leaves
// the console: a whole number of days, 0-30 - the server's own bounds.
export async function setStorefrontSubscriptionGraceAction(
  webhookId: string,
  graceDays: number
): Promise<ValidatedActionResult<boolean>> {
  const { identity, tenantApiKey } = await requireSessionWithTenantKey();
  if (!Number.isInteger(graceDays) || graceDays < 0 || graceDays > 30) {
    return { ok: false, reason: 'validation', message: 'Enter a whole number of days from 0 to 30' };
  }
  try {
    const data = await setStorefrontSubscriptionGraceOnServer(webhookId, graceDays, tenantApiKey);
    return { ok: true, data };
  } catch (err) {
    if (isRateLimited(err)) return { ok: false, reason: 'rate-limited' };
    markIfTenantRejected(err, identity.tenantId);
    if (err instanceof Error) return { ok: false, reason: 'validation', message: err.message };
    throw err;
  }
}

export async function disableStorefrontWebhookAction(webhookId: string): Promise<SimpleActionResult<boolean>> {
  const { identity, tenantApiKey } = await requireSessionWithTenantKey();
  try {
    const data = await disableStorefrontWebhookOnServer(webhookId, tenantApiKey);
    return { ok: true, data };
  } catch (err) {
    if (isRateLimited(err)) return { ok: false, reason: 'rate-limited' };
    markIfTenantRejected(err, identity.tenantId);
    throw err;
  }
}

export async function listStorefrontMappingsAction(webhookId: string): Promise<SimpleActionResult<StorefrontMapping[]>> {
  const { identity, tenantApiKey } = await requireSessionWithTenantKey();
  try {
    const data = await listStorefrontMappingsOnServer(webhookId, tenantApiKey);
    return { ok: true, data };
  } catch (err) {
    if (isRateLimited(err)) return { ok: false, reason: 'rate-limited' };
    markIfTenantRejected(err, identity.tenantId);
    throw err;
  }
}

export async function createStorefrontMappingAction(
  webhookId: string,
  input: CreateStorefrontMappingInput
): Promise<ValidatedActionResult<{ id: string }>> {
  const { identity, tenantApiKey } = await requireSessionWithTenantKey();
  try {
    const data = await createStorefrontMappingOnServer(webhookId, input, tenantApiKey);
    return { ok: true, data };
  } catch (err) {
    if (isRateLimited(err)) return { ok: false, reason: 'rate-limited' };
    markIfTenantRejected(err, identity.tenantId);
    if (err instanceof Error) return { ok: false, reason: 'validation', message: err.message };
    throw err;
  }
}

export async function deleteStorefrontMappingAction(
  webhookId: string,
  mappingId: string
): Promise<SimpleActionResult<boolean>> {
  const { identity, tenantApiKey } = await requireSessionWithTenantKey();
  try {
    const data = await deleteStorefrontMappingOnServer(webhookId, mappingId, tenantApiKey);
    return { ok: true, data };
  } catch (err) {
    if (isRateLimited(err)) return { ok: false, reason: 'rate-limited' };
    markIfTenantRejected(err, identity.tenantId);
    throw err;
  }
}

export async function listStorefrontDeliveriesAction(
  webhookId: string,
  params: { limit?: number; offset?: number }
): Promise<SimpleActionResult<ListStorefrontDeliveriesResult>> {
  const { identity, tenantApiKey } = await requireSessionWithTenantKey();
  try {
    const data = await listStorefrontDeliveriesOnServer(webhookId, params, tenantApiKey);
    return { ok: true, data };
  } catch (err) {
    if (isRateLimited(err)) return { ok: false, reason: 'rate-limited' };
    markIfTenantRejected(err, identity.tenantId);
    throw err;
  }
}
