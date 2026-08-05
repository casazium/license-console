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
// license-client.live.ts's issueLicense() is the one function that
// preserves the server's own error text for 403s rather than the
// generic "Failed to X: status statusText" every other function throws,
// specifically so these two are distinguishable here.
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
