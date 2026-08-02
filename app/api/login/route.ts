import { NextRequest, NextResponse } from 'next/server';
import { verifyCredentials } from '@/lib/auth';
import { createSessionToken, sessionCookieOptions, SESSION_COOKIE_NAME } from '@/lib/session';
import { checkLoginRateLimit, recordFailedLoginAttempt, clearLoginRateLimit, getClientKey } from '@/lib/login-rate-limit';

export async function POST(request: NextRequest) {
  const clientKey = getClientKey(request);

  const rateLimit = checkLoginRateLimit(clientKey);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many login attempts. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    );
  }

  const body = await request.json().catch(() => null);
  const username = body?.username;
  const password = body?.password;

  if (typeof username !== 'string' || typeof password !== 'string') {
    return NextResponse.json({ error: 'Username and password are required' }, { status: 400 });
  }

  const identity = await verifyCredentials(username, password);
  if (!identity) {
    recordFailedLoginAttempt(clientKey);
    return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
  }

  clearLoginRateLimit(clientKey);
  const token = await createSessionToken(identity);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions);
  return response;
}
