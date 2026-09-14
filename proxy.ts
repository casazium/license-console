import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME, verifySessionToken } from '@/lib/session';

// /signup, /api/signup, /forgot-password, /api/forgot-password,
// /reset-password, /api/reset-password, and /api/verify-email are all
// listed unconditionally, not gated on isMultiTenant() here - each
// self-gates instead (404 on the page or route), matching this proxy's
// own role of session-checking, not feature-flagging.
//
// /api/verify-email and /api/reset-password deliberately don't require
// a session - the one-time token in the link/request IS the credential
// (see each route's own header comment). A real, previously-shipped bug
// was found and fixed here alongside adding the password-reset paths:
// /api/verify-email was missing from this list entirely, so a person
// clicking their real confirmation link from a different browser,
// device, or after their session had simply expired was silently
// bounced to /login before the route ever ran - reproduced directly
// with a fresh, cookie-less browser context before this fix.
//
// /api/verify-email/resend intentionally still requires a session (its
// own route enforces this internally via requireSession()) despite
// prefix-matching under '/api/verify-email' here - same acceptable
// looseness this list already had for /signup vs. any hypothetical
// /signup/* sub-route, since the route's own check is the real
// boundary, not this list.
//
// /api/logout (security review finding L1): the route itself has no
// session check at all - it unconditionally deletes the session
// cookie, nothing sensitive to protect - so its absence from this list
// was itself the bug: an expired-but-still-present cookie failed
// verifySessionToken() here, this proxy redirected to /login before
// the route ever ran, and the sign-out button's own POST never got a
// chance to clear that stale cookie. Confirmed live: an unauthenticated
// POST here previously 307'd to /login instead of clearing the cookie.
//
// /api/admin/report-extract (SUPERADMIN_REPORTING_DESIGN.md §6): same
// shape as /api/verify-email above - its own bearer REPORT_EXTRACT_KEY
// check (lib/report-extract-auth.ts) IS the real credential, not this
// proxy's session cookie. Its only intended caller (casazium/license's
// scripts/tenant-report.js) never holds a console session at all - found
// live during end-to-end smoke testing: an unauthenticated request with
// a correct bearer token still 307'd to /login before the route handler
// (and its own auth check) ever ran, making REPORT_EXTRACT_KEY
// unreachable dead code. This route's own check is what actually gates
// it, exactly as intended - this list entry only stops a *different*
// gate from shadowing it first.
//
// /api/health/db (BETA_LAUNCH_STATUS.md §4): the same recurring shape a
// third time - Coolify's own container healthcheck (docker-compose-
// coolify.yml) calls this route directly, with no session cookie at
// all, and its own request has nothing to authenticate in the first
// place (it just proves the database connection is alive, no
// credential-gated data in the response). Found the same way as the two
// entries above - live, not by inspection: curled this route right
// after wiring it into the healthcheck and got a 307 to /login instead
// of a health check response, which would have made every deploy report
// unhealthy forever regardless of the database's real state.
const PUBLIC_PATHS = [
  '/login',
  '/api/login',
  '/api/logout',
  '/signup',
  '/api/signup',
  '/forgot-password',
  '/api/forgot-password',
  '/reset-password',
  '/api/reset-password',
  '/api/verify-email',
  '/api/admin/report-extract',
  '/api/health/db',
];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((path) => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const identity = token ? await verifySessionToken(token) : null;

  if (!identity) {
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

// robots.txt joins favicon.ico here rather than PUBLIC_PATHS above: it's a
// static, unconditionally-public asset with no session semantics at all, so
// the cheapest correct thing is for this proxy never to run for it. Without
// the exclusion it matched the catch-all, failed the session check, and
// 307'd to /login - confirmed live on both instances, which meant neither
// served crawl directives at all (see app/robots.ts).
//
// fonts/img (redesign work, PROJECT_STATUS.md): same reasoning exactly -
// public/ held nothing but a .gitkeep before the self-hosted IBM Plex fonts
// and logo mark were added, so this matcher never had to account for real
// static assets living there. Without this exclusion, /fonts/*.woff2
// 307'd to /login the same way robots.txt used to - confirmed live via a
// direct curl - which broke the login page's own fonts, since a page whose
// entire job is being reachable pre-session can't depend on an asset the
// session gate itself blocks.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|fonts|img).*)'],
};
