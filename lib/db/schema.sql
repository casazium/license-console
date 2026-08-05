-- lib/db/schema.sql
--
-- SaaS-B1a: persistence layer only, no application tables yet. This file
-- is applied via db.exec() on every connection open (lib/db.ts), the same
-- `CREATE TABLE IF NOT EXISTS` / defensive-migration convention
-- casazium/license's own src/db/schema.sql + src/app.js use - no
-- migration framework, safe to re-run unconditionally.
--
-- SaaS-B1c (a sessions table, if the revocation strategy decided there
-- ends up needing server-side session state rather than a pure
-- JWT-blocklist approach) adds its own statements here.

-- SaaS-B1b: one row per human console login, only under MULTI_TENANT.
-- tenant_id is this server's tenant id (casazium/license, SaaS-A0) - not
-- a foreign key to anything in *this* DB, since tenants live in that
-- repo's own separate database. Stored alongside the encrypted key
-- (rather than derived by decrypting it) so a future session (SaaS-B1c)
-- can carry tenantId without a decrypt on every request. Multiple
-- accounts sharing one tenant_id (team invites) is schema-compatible but
-- not built by this task - SaaS-B1b's own signup flow only ever creates
-- a new tenant + its first account together.
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  tenant_api_key_encrypted TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Not declared UNIQUE inline on the column, matching casazium/license's
-- own convention (that repo's idx_tenants_api_key_hash comment) of
-- adding uniqueness as a separate index rather than inline.
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email);
