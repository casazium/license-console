/**
 * SaaS tier feature flag (SaaS-B1b), mirroring casazium/license's own
 * MULTI_TENANT flag (that repo's lib/config.js) - same name, same
 * default-false-for-self-hosted intent, kept as a plain function reading
 * process.env live rather than a cached module-level constant for the
 * same reason that repo's own comment gives: safe for a future test
 * suite to flip per-file without fighting module-load-order caching.
 *
 * Off (the default): lib/auth.ts's verifyCredentials() stays exactly the
 * single static ADMIN_UI_USERNAME/ADMIN_UI_PASSWORD pair it is today -
 * self-hosted deployments never touch the accounts table or signup flow
 * at all. On: it checks the accounts table instead, and /signup becomes
 * reachable.
 */
export function isMultiTenant(): boolean {
  return process.env.MULTI_TENANT === 'true';
}
