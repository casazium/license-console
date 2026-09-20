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

// The exact 403 message casazium/license's issue-license.js/
// register-release.js return for a permanently retired product_id
// (security review finding, fresh audit, 2026-09 - permanent product_id
// retirement; operator follow-up, "distinguish the two cases"). Before
// that fix, a deleted account's or abandoned last license's product_id
// was simply freed back to the open pool, indistinguishable from any
// other fresh claim - now the backend intentionally returns a different
// message, because "owned by a different tenant" would be actively
// wrong here: nobody currently owns it, it's retired, and no amount of
// picking a different account or waiting will change that - only an
// admin's release-product-id action can. Kept as a separate classifier
// rather than folded into isProductIdTaken above precisely so the two
// cases can get different, accurate UI copy.
export function isProductIdRetired(error: unknown): boolean {
  return (
    error instanceof LicenseApiError &&
    error.status === 403 &&
    error.message ===
      'product_id has been retired and is no longer available - contact support to have it released'
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

// Fastify's own schema-validation error text for any of
// register-release.js's maxLength fields (release_notes since round 3's
// finding B-4; product_id/version/channel/platform/artifact_url/checksum
// added in round 5's finding F5-4). Matches the message *shape*, not a
// hardcoded field name or character limit (round-6 focused review,
// findings R6-3/R6-4): round 5 added six new bounded fields but this
// app's own classifier only ever covered release_notes by exact string
// match, so the other six fell through to the generic "Something went
// wrong" fallback - and even the one classifier that did exist was
// tautological against its own unit test (it fed the classifier the
// same literal the classifier compared against), so a Fastify/ajv
// wording bump on the generated tail ("must NOT have more than N
// characters") would have silently broken it in production with the
// test staying green. `field` is matched case-insensitively against
// Fastify's own capitalized-first-letter convention (see
// app.js's setErrorHandler) so callers pass the field name in its
// natural casing.
function isTooLong(error: unknown, field: string): boolean {
  if (!(error instanceof LicenseApiError) || error.status !== 400) return false;
  return new RegExp(`^${field} must NOT have more than \\d+ characters$`, 'i').test(error.message);
}

export function isReleaseNotesTooLong(error: unknown): boolean {
  return isTooLong(error, 'release_notes');
}

export function isProductIdTooLong(error: unknown): boolean {
  return isTooLong(error, 'product_id');
}

export function isVersionTooLong(error: unknown): boolean {
  return isTooLong(error, 'version');
}

export function isChannelTooLong(error: unknown): boolean {
  return isTooLong(error, 'channel');
}

export function isPlatformTooLong(error: unknown): boolean {
  return isTooLong(error, 'platform');
}

export function isChecksumTooLong(error: unknown): boolean {
  return isTooLong(error, 'checksum');
}

export function isArtifactUrlTooLong(error: unknown): boolean {
  return isTooLong(error, 'artifact_url');
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
