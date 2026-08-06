import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { isMultiTenant } from './config';
import { getDb } from './db';

// Which credential system authenticated this identity - 'saas' for a
// real accounts-table row (MULTI_TENANT=true at issuance), 'selfhosted'
// for the single shared ADMIN_UI_USERNAME/PASSWORD pair. Embedded in the
// signed JWT at issuance (security review finding, third-party audit,
// R3-CONSOLE-H1) specifically so verifySessionToken() can reject a
// mode-mismatched token *without* needing a DB call - see that
// function's own comment for why that independence from the DB matters.
export type SessionMode = 'saas' | 'selfhosted';

export type Identity = {
  id: string;
  role: 'admin';
  // Which credential system authenticated this identity at issuance -
  // see SessionMode's own comment above. Required (not optional) so
  // every call site that builds an Identity is forced to state it
  // explicitly, rather than a mode-check silently no-op'ing on `undefined`.
  mode: SessionMode;
  // Only populated under MULTI_TENANT=true (SaaS-B1c), re-derived from
  // the accounts table on every verifySessionToken() call rather than
  // embedded in the signed JWT payload at issuance - the DB is the
  // single source of truth for an account's current tenant, and a
  // lookup is already required per request under SaaS mode to check
  // revocation (below), so this doesn't cost an extra query.
  tenantId?: string;
  // Same reasoning as tenantId above - piggybacks on that same
  // required-anyway lookup rather than a separate query. Only
  // meaningful under MULTI_TENANT; self-hosted's single shared admin
  // login has no email/verification concept at all.
  emailVerified?: boolean;
};

export const SESSION_COOKIE_NAME = 'license_console_session';

const SESSION_DURATION = '8h';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;

// 32 chars is a floor, not a target - .env.example recommends
// `openssl rand -base64 32`, which produces 44 characters. This only
// rejects trivially weak values (e.g. "changeme"); it can't verify the
// secret is actually random, just that it isn't obviously too short to be.
const MIN_SESSION_SECRET_LENGTH = 32;

function getSecretKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('Missing required environment variable: SESSION_SECRET');
  }
  if (secret.length < MIN_SESSION_SECRET_LENGTH) {
    throw new Error(
      `SESSION_SECRET must be at least ${MIN_SESSION_SECRET_LENGTH} characters - ` +
        'generate one with `openssl rand -base64 32`.'
    );
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(identity: Identity): Promise<string> {
  return new SignJWT({ ...identity })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(SESSION_DURATION)
    .sign(getSecretKey());
}

/**
 * SaaS-B1c revocation. Sessions are stateless 8h JWTs (no server-side
 * session table - a deliberate choice, see PROJECT_STATUS.md §31) so
 * there's nothing to delete on revoke; instead, every account carries a
 * `sessions_revoked_at` watermark (lib/db/schema.sql), and any token
 * issued at or before that watermark is rejected here regardless of its
 * own (still-valid) signature and expiry. Coarse by design - revokes
 * every session for the account, not one specific device - which is
 * exactly the granularity both of B1c's actual triggers need: a future
 * password-reset flow revoking that one account, or a whole tenant being
 * revoked on casazium/license cascading to every account under it
 * (`UPDATE ... WHERE tenant_id = ?` instead of `WHERE id = ?`, once
 * SaaS-B1b's "one account per tenant" simplification is lifted).
 */
export function revokeAccountSessions(accountId: string): void {
  getDb().prepare('UPDATE accounts SET sessions_revoked_at = CURRENT_TIMESTAMP WHERE id = ?').run(accountId);
}

export async function verifySessionToken(token: string): Promise<Identity | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    if (
      typeof payload.id !== 'string' ||
      payload.role !== 'admin' ||
      (payload.mode !== 'saas' && payload.mode !== 'selfhosted')
    ) {
      return null;
    }

    // Security review finding, third-party audit (R3-CONSOLE-H1): the
    // *only* place this file previously distinguished SaaS from
    // self-hosted was the isMultiTenant() check a few lines below - and
    // every caller that resolves tenant context (getBranding,
    // requireSessionWithTenantKey, license-client's resolveApiKey) short-
    // circuits on !isMultiTenant() *before ever calling getDb()*. If
    // MULTI_TENANT was ever true when a session was issued and then
    // becomes unset (a lost Coolify env var on redeploy - the exact
    // failure mode DEPLOYMENT.md already documents), that still-valid,
    // still-signed JWT kept verifying as a plain self-hosted admin
    // identity, and every downstream license-server call silently fell
    // back to the platform-wide LICENSE_ADMIN_API_KEY instead of the
    // tenant's own key - confirmed live by a third-party audit, which
    // also confirmed the DB-level guard in lib/db.ts never fires on this
    // path, since nothing on it touches the DB at all.
    //
    // This check needs no DB access - the token's own `mode` claim
    // (set at issuance in verifyCredentials()/signup/reset-password, see
    // SessionMode's own comment) is proof enough of which credential
    // system authenticated it, and a 'saas' token straightforwardly
    // shouldn't be honored when this deployment isn't in SaaS mode right
    // now, regardless of what it was when the token was issued.
    if (payload.mode === 'saas' && !isMultiTenant()) {
      return null;
    }

    const identity: Identity = { id: payload.id, role: payload.role, mode: payload.mode };

    if (isMultiTenant()) {
      const account = getDb()
        .prepare(
          'SELECT tenant_id, sessions_revoked_at, email_verified_at, tenant_revoked_at FROM accounts WHERE id = ?'
        )
        .get(identity.id) as
        | {
            tenant_id: string;
            sessions_revoked_at: string | null;
            email_verified_at: string | null;
            tenant_revoked_at: string | null;
          }
        | undefined;

      // The account backing this token no longer exists (or was never a
      // SaaS account, e.g. a stale token from before MULTI_TENANT was
      // enabled) - reject rather than return a sessionless Identity.
      if (!account) {
        return null;
      }

      // tenant_revoked_at ("trigger 2", lib/db/schema.sql's own comment on
      // this column): a persistent gate, not a point-in-time watermark
      // like sessions_revoked_at below - checked as "is this set at all",
      // not compared against payload.iat, since a revoked tenant must
      // stay locked out of every *future* login too, not just whatever
      // sessions existed at the moment it was set.
      if (account.tenant_revoked_at) {
        return null;
      }

      if (account.sessions_revoked_at && typeof payload.iat === 'number') {
        // SQLite's CURRENT_TIMESTAMP has no timezone marker but is always
        // UTC - appending 'Z' is required for Date to parse it as UTC
        // instead of the server's local time (confirmed empirically).
        const revokedAtSeconds = Math.floor(new Date(`${account.sessions_revoked_at}Z`).getTime() / 1000);
        // Strictly less-than, not <=: both `iat` (JWT's NumericDate, per
        // spec) and CURRENT_TIMESTAMP are whole-second precision, so a
        // fresh re-login in the same wall-clock second as the revocation
        // it's meant to follow (e.g. reset password, log back in
        // immediately) would otherwise compare equal and be wrongly
        // rejected - confirmed empirically, this was a real bug during
        // this task's own verification, not a hypothetical. The
        // trade-off is a real one but narrow: a token issued a fraction
        // of a second *before* the revocation, in that same second,
        // survives one extra second past its revocation instead of dying
        // immediately - inherent to JWT `iat`'s second-level resolution,
        // not something fixable by changing this comparison alone.
        if (payload.iat < revokedAtSeconds) {
          return null;
        }
      }

      identity.tenantId = account.tenant_id;
      identity.emailVerified = account.email_verified_at !== null;
    }

    return identity;
  } catch {
    return null;
  }
}

/**
 * Non-throwing peek at the current session, for the one real place that
 * legitimately doesn't know in advance whether a session exists: the
 * root layout (app/layout.tsx, SaaS-B3), which wraps both pre-auth pages
 * (/login, /signup - no session, by definition) and the authenticated
 * app (always has one, per proxy.ts). Everywhere else that needs "there
 * must be a session" should use requireSession() below, not this.
 */
export async function getSession(): Promise<Identity | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  return token ? await verifySessionToken(token) : null;
}

/**
 * Two distinct reasons to call this, both real: Server Actions have no
 * request object to read - proxy.ts's middleware check never runs for
 * them (its matcher only covers page/route navigation, not action
 * invocations), so each action must verify the session itself rather
 * than relying on middleware alone. Confirmed not currently exploitable
 * on Next 16.2.12 (action IDs are scoped to the pages that bundle them),
 * but that's a Next internal, not a guarantee - this is the actual
 * authorization boundary for actions.
 *
 * Read pages (Server Components) are already gated by proxy.ts, so this
 * isn't their authorization boundary - they call it instead (SaaS-B2) to
 * resolve the current account's `tenantId`, which license-client's
 * dispatcher functions need threaded through to know which tenant's key
 * to use. Renamed from requireSessionForAction to reflect this broader
 * use; the underlying check is identical either way.
 */
export async function requireSession(): Promise<Identity> {
  const identity = await getSession();
  if (!identity) {
    throw new Error('Unauthorized');
  }
  return identity;
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: SESSION_MAX_AGE_SECONDS,
};
