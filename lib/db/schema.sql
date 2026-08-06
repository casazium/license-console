-- lib/db/schema.sql
--
-- SaaS-B1a: persistence layer only, no application tables yet. This file
-- is applied via db.exec() on every connection open (lib/db.ts), the same
-- `CREATE TABLE IF NOT EXISTS` / defensive-migration convention
-- casazium/license's own src/db/schema.sql + src/app.js use - no
-- migration framework, safe to re-run unconditionally.
--
-- SaaS-B1c resolved the revocation-strategy fork this comment used to
-- describe: a JWT-blocklist watermark (accounts.sessions_revoked_at
-- below), not a separate sessions table - both of B1c's actual triggers
-- (password reset, a tenant revoked on casazium/license) only ever need
-- to invalidate *every* session for an account/tenant at once, never one
-- specific device, so there's nothing a dedicated per-session table would
-- buy here. See lib/session.ts's verifySessionToken() for the check.

-- SaaS-B1b: one row per human console login, only under MULTI_TENANT.
-- tenant_id is this server's tenant id (casazium/license, SaaS-A0) - not
-- a foreign key to anything in *this* DB, since tenants live in that
-- repo's own separate database. Stored alongside the encrypted key
-- (rather than derived by decrypting it) so a session (SaaS-B1c) can
-- carry tenantId without a decrypt on every request. Multiple accounts
-- sharing one tenant_id (team invites) is schema-compatible but not
-- built by this task - SaaS-B1b's own signup flow only ever creates a
-- new tenant + its first account together.
--
-- sessions_revoked_at (SaaS-B1c): nullable watermark, unset until the
-- first revocation. Directly on accounts rather than a separate table
-- for the same "no per-session granularity needed" reason above - added
-- straight into this CREATE TABLE, not a defensive ALTER, since this
-- table is new on an unmerged branch with no real deployment yet to
-- migrate (PROJECT_STATUS.md §5's disposability rule: an unmerged branch
-- means the old shape never shipped).
-- tenant_name (SaaS-B5): the "Company / organization" value collected
-- (and previously discarded) by the signup form, stored so the
-- onboarding flow can personalize its welcome copy without a round
-- trip to casazium/license - that server's own tenants.name isn't
-- exposed by any tenant-scoped route, and fetching it would mean a new
-- one just for this. Nullable, not because it's ever actually unset for
-- a signed-up account (SaaS-B1b's flow always collects and would
-- populate it), but so old rows from before this column existed don't
-- need a backfill on an unmerged branch with no real data anyway (§5).
-- email_verified_at (signup confirmation email): nullable watermark, same
-- shape as sessions_revoked_at above - unset until the confirmation link
-- is actually clicked. Added straight into this CREATE TABLE rather than
-- a defensive ALTER for the same reason tenant_name was (§5's
-- disposability rule: no real deployment yet to migrate).
--
-- tenant_revoked_at: the "trigger 2" session.ts's own header comment on
-- sessions_revoked_at flagged as unbuilt - a tenant being revoked on
-- casazium/license, cascading to every account under it. Deliberately a
-- SEPARATE column from sessions_revoked_at, not the same watermark
-- reused: sessions_revoked_at only rejects tokens issued *before* it (a
-- fresh login always produces a newer, still-valid token, which is
-- exactly right for password-reset - the person proved they own the
-- account and should get back in immediately - but wrong here, where a
-- revoked tenant must stay locked out of *every* future login too, not
-- just their currently-open sessions). This is checked as a persistent
-- gate (is it set at all), not a time comparison - see
-- lib/session.ts's verifySessionToken(). Set reactively (a
-- license-server call surfacing the tenant's own "Unauthorized" 403,
-- lib/errors.ts's isTenantRejected()) or at login time (a fresh probe
-- against the license server, app/api/login/route.ts) - never proactively
-- pushed from casazium/license, which has no way to reach this console
-- at all today and isn't being given one; see PROJECT_STATUS.md for the
-- full design record and why that gap is accepted, not a bug to fix
-- later.
--
-- Self-healing (security review finding M5, PROJECT_STATUS.md): that
-- same login-time probe also clears this gate on a successful response
-- (lib/tenant-context.ts's clearTenantRevoked()) - a real 403 can't
-- distinguish genuine revocation from any other reason the stored
-- credential stopped matching (a key rotated on the server without this
-- console being updated, a rebuilt tenants table, ...), so a later
-- successful check is treated as real, current proof the account is
-- valid again, not just a one-way lockout requiring manual DB surgery.
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  tenant_name TEXT,
  tenant_api_key_encrypted TEXT NOT NULL,
  sessions_revoked_at DATETIME,
  email_verified_at DATETIME,
  tenant_revoked_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Not declared UNIQUE inline on the column, matching casazium/license's
-- own convention (that repo's idx_tenants_api_key_hash comment) of
-- adding uniqueness as a separate index rather than inline.
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email);

-- One-time signup-confirmation links. Only the hash is stored (mirrors
-- casazium/license's own activations.token_hash / lib/activation-token.js
-- pattern) - the plaintext token only ever exists in the confirmation
-- URL itself, never at rest. A real foreign key here (unlike
-- accounts.tenant_id above, which points at a row in a different repo's
-- database entirely) - account_id is in this same database, so the
-- guarantee can be enforced at the DB level rather than left to
-- app-level discipline.
CREATE TABLE IF NOT EXISTS email_verification_tokens (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_account_id
  ON email_verification_tokens(account_id);

-- One-time password-reset links. Same shape and hashed-at-rest
-- reasoning as email_verification_tokens above, deliberately a
-- separate table rather than a shared one with a "purpose" column - a
-- compromised password-reset token means full account takeover, a
-- compromised email-confirmation token doesn't, and they carry
-- different expiry windows (1h vs 24h, set in application code) for
-- exactly that reason. Keeping them structurally distinct means a bug
-- in one flow's token handling can't accidentally cross-apply to the
-- other's much higher-stakes one.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_account_id
  ON password_reset_tokens(account_id);

-- SaaS-B3: one row per tenant, only under MULTI_TENANT. tenant_id is not
-- a foreign key here either, same reasoning as accounts.tenant_id above.
-- Every column nullable and independently optional - lib/branding.ts
-- falls back field-by-field to the env-var/platform default (not
-- row-absent-or-not), so a tenant can override just BRANDING_COLOR
-- without needing to also supply a logo. No row at all (the common
-- case - nothing writes this table yet, see lib/branding.ts's own
-- comment) falls back to the platform default entirely, byte-identical
-- to self-hosted.
CREATE TABLE IF NOT EXISTS tenant_branding (
  tenant_id TEXT PRIMARY KEY,
  logo_url TEXT,
  title_html TEXT,
  copyright_holder TEXT,
  color TEXT,
  favicon_url TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
