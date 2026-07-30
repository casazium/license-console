import { NextRequest, NextResponse } from 'next/server';
import { verifyCredentials } from '@/lib/auth';
import { createSessionToken, sessionCookieOptions, SESSION_COOKIE_NAME } from '@/lib/session';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const password = body?.password;

  if (typeof password !== 'string') {
    return NextResponse.json({ error: 'Password is required' }, { status: 400 });
  }

  const identity = await verifyCredentials(password);
  if (!identity) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
  }

  const token = await createSessionToken(identity);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions);
  return response;
}
