import { SignJWT, jwtVerify } from 'jose';

export type Identity = {
  id: string;
  role: 'admin';
};

export const SESSION_COOKIE_NAME = 'license_console_session';

const SESSION_DURATION = '8h';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;

function getSecretKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('Missing required environment variable: SESSION_SECRET');
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(identity: Identity): Promise<string> {
  return new SignJWT({ ...identity })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(SESSION_DURATION)
    .sign(getSecretKey());
}

export async function verifySessionToken(token: string): Promise<Identity | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    if (typeof payload.id !== 'string' || payload.role !== 'admin') {
      return null;
    }
    return { id: payload.id, role: payload.role };
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: SESSION_MAX_AGE_SECONDS,
};
