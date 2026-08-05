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
const PUBLIC_PATHS = [
  '/login',
  '/api/login',
  '/signup',
  '/api/signup',
  '/forgot-password',
  '/api/forgot-password',
  '/reset-password',
  '/api/reset-password',
  '/api/verify-email',
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

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
