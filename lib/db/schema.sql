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
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  tenant_name TEXT,
  tenant_api_key_encrypted TEXT NOT NULL,
  sessions_revoked_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Not declared UNIQUE inline on the column, matching casazium/license's
-- own convention (that repo's idx_tenants_api_key_hash comment) of
-- adding uniqueness as a separate index rather than inline.
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email);

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
