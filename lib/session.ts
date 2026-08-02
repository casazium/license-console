import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

export type Identity = {
  id: string;
  role: 'admin';
};

export const SESSION_COOKIE_NAME = 'license_console_session';

const SESSION_DURATION = '8h';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;

// 32 chars is a floor, not a target - .env.example recommends
// `openssl rand -base64 32`, which produces 44 characters. This only
// rejects trivially weak values (e.g. "changeme"); it can't verify the
// secret is actually random, just that it isn't obviously too short to be.
const MIN_SESSION_SECRET_LENGTH = 32;

function getSecretKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('Missing required environment variable: SESSION_SECRET');
  }
  if (secret.length < MIN_SESSION_SECRET_LENGTH) {
    throw new Error(
      `SESSION_SECRET must be at least ${MIN_SESSION_SECRET_LENGTH} characters - ` +
        'generate one with `openssl rand -base64 32`.'
    );
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

/**
 * Server Actions have no request object to read - proxy.ts's middleware
 * check never runs for them (its matcher only covers page/route navigation,
 * not action invocations), so each action must verify the session itself
 * rather than relying on middleware alone. Confirmed not currently
 * exploitable on Next 16.2.12 (action IDs are scoped to the pages that
 * bundle them), but that's a Next internal, not a guarantee - this is the
 * actual authorization boundary for actions.
 */
export async function requireSessionForAction(): Promise<Identity> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  const identity = token ? await verifySessionToken(token) : null;
  if (!identity) {
    throw new Error('Unauthorized');
  }
  return identity;
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: SESSION_MAX_AGE_SECONDS,
};
