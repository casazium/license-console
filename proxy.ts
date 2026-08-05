import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME, verifySessionToken } from '@/lib/session';

// /signup and /api/signup (SaaS-B1b) are listed unconditionally, not
// gated on isMultiTenant() here - both self-gate instead (the route
// returns 404, the page calls notFound()), matching this proxy's own
// role of session-checking, not feature-flagging.
const PUBLIC_PATHS = ['/login', '/api/login', '/signup', '/api/signup'];

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
