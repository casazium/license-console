// Thrown by license-client.live.ts's !res.ok branches instead of a plain
// Error, so callers can distinguish "the backend rate-limited us" (a
// routine, expected condition worth a friendly message) from any other
// failure - see isRateLimited() below.
//
// Only useful where the error is caught server-side, before it crosses a
// Server Component render boundary or a Server Action's return - Next.js
// redacts thrown-error details (message, name, and any custom properties
// like `status`) to a generic message + opaque digest once an error
// reaches the client in a production build. Confirmed directly: a
// throwTestError() Server Action reproduced the exact same redacted
// message React 418/§22's Server Component crash showed, for both
// surfaces. So this class is only useful *before* that boundary - pages
// must catch it and render inline instead of re-throwing, and Server
// Actions must catch it and return a structured result instead of
// re-throwing, or the status information is lost either way.
export class LicenseApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'LicenseApiError';
    this.status = status;
  }
}

export function isRateLimited(error: unknown): boolean {
  return error instanceof LicenseApiError && error.status === 429;
}

// SaaS-B4. Both are 403s from POST /issue-license specifically -
// casazium/license's src/lib/quota.js is the only place either of these
// exact strings comes from (checked in that order there too: a
// non-active subscription blocks before the quota count is even read).
// license-client.live.ts preserves the server's own error text for every
// 403 (a shared helper, not just issueLicense() specifically - see that
// file's own throwForFailedResponse()), which is what makes these three
// 403-message checks (this pair, plus isTenantRejected below)
// distinguishable from each other and from an ordinary 403.
export function isOverQuota(error: unknown): boolean {
  return (
    error instanceof LicenseApiError &&
    error.status === 403 &&
    error.message === 'License issuance quota exceeded'
  );
}

export function isPaymentFailed(error: unknown): boolean {
  return (
    error instanceof LicenseApiError &&
    error.status === 403 &&
    error.message === 'Subscription is not active'
  );
}

// The exact, deliberately generic message require-tenant-scoped-access.js
// (casazium/license) returns for every rejection reason alike - missing
// credential, unknown credential, or (this trigger's actual case) a
// tenant whose status isn't 'active' - specifically to avoid letting a
// caller distinguish those cases from the outside (a credential-type
// oracle). That's correct for the license server's own boundary, but it
// means this classifier can't tell "wrong/missing key" apart from "right
// key, revoked tenant" either - both are legitimate reasons this console
// itself would only ever see this exact error using a key it already
// decrypted from its own accounts table, so treating either as "this
// tenant is no longer usable" (see lib/tenant-context.ts's
// markTenantRevoked()) is the correct call regardless of which one it
// actually was.
export function isTenantRejected(error: unknown): boolean {
  return error instanceof LicenseApiError && error.status === 403 && error.message === 'Unauthorized';
}

// The exact 403 message casazium/license's issue-license.js returns when
// the submitted product_id is already claimed by a different tenant
// (per-tenant product_id ownership binding). Unlike isTenantRejected
// above, this isn't a credential problem - the caller's own key is fine,
// but the specific product_id in this one request is not usable. Retrying
// the same input can never succeed; the console needs to tell the user to
// pick a different product_id rather than show a generic "try again"
// error (beta-readiness finding: this is the first thing a new signup's
// onboarding form can hit, since a handful of concurrent beta users are
// likely to type the same obvious product_id, e.g. "demo" or "test").
export function isProductIdTaken(error: unknown): boolean {
  return (
    error instanceof LicenseApiError &&
    error.status === 403 &&
    error.message === 'product_id is owned by a different tenant'
  );
}
