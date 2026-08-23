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

// The exact 400 message casazium/license's register-release.js returns
// when the submitted product_id starts with the reserved `_casazium_`
// prefix (round-3 independent review, console finding C-1's companion -
// registerReleaseAction fell through this, and the payment-failed 403
// below, to a generic "something went wrong" that gave the tenant no way
// to know their own input was the problem). Like isProductIdTaken above,
// retrying the same input can never succeed.
export function isReservedProductId(error: unknown): boolean {
  return (
    error instanceof LicenseApiError &&
    error.status === 400 &&
    error.message === 'product_id uses a reserved prefix'
  );
}

// The exact 400 message casazium/license's register-release.js returns
// when artifact_url isn't a valid http(s) URL (round-3 independent
// review, finding B-5's companion) - round-5 independent review, finding
// F5-6: this classifier didn't exist at all, so a rejected artifact_url
// fell all the way through to the generic "Something went wrong" catch,
// even though the underlying 400 detail had been reachable since round
// 4's own throwForFailedResponse fix. Retrying the same URL can never
// succeed, same as isReservedProductId above.
export function isInvalidArtifactUrl(error: unknown): boolean {
  return (
    error instanceof LicenseApiError &&
    error.status === 400 &&
    error.message === 'artifact_url must be a valid http(s) URL'
  );
}

// Fastify's own schema-validation error text for register-release.js's
// release_notes maxLength: 10000 (round-3 independent review, finding
// B-4) - not a hand-written message, so this couples to that exact
// limit; if the limit in register-release.js's schema ever changes,
// update this string to match (round-5 independent review, finding
// F5-6, same "classifier never existed" gap as isInvalidArtifactUrl
// above).
export function isReleaseNotesTooLong(error: unknown): boolean {
  return (
    error instanceof LicenseApiError &&
    error.status === 400 &&
    error.message === 'Release_notes must NOT have more than 10000 characters'
  );
}

// The exact 409 message casazium/license's register-release.js returns
// when a *published* release already exists for the exact
// {product_id, version, channel, platform} tuple (round-4 independent
// review, finding F5). Round-5 independent review, finding F5-6: the
// classifier existed nowhere and throwForFailedResponse didn't even
// preserve 409 bodies at all until this same round - a duplicate
// registration fell through to "Something went wrong. Please try
// again," which is actively misleading here, since retrying the exact
// same input can never succeed (unpublishing the existing release
// first, then retrying, does - see saas-tier.md's Software
// Distribution section).
export function isDuplicateRelease(error: unknown): boolean {
  return (
    error instanceof LicenseApiError &&
    error.status === 409 &&
    error.message === 'A release already exists for this product_id/version/channel/platform'
  );
}

// The exact 403 message casazium/license's register-release.js returns
// when a {product_id, channel, platform} bucket has reached its
// 500-published-release cap (round-5 independent review, finding F5-5).
// Distinct from isPaymentFailed/isProductIdTaken above - retrying the
// same input can succeed once an old release in that same bucket is
// unpublished, so the UI copy for this case should say that, not just
// "something went wrong."
export function isReleaseLimitReached(error: unknown): boolean {
  return (
    error instanceof LicenseApiError &&
    error.status === 403 &&
    error.message.startsWith('Release limit reached')
  );
}
