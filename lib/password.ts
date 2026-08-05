import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

/**
 * Password hashing for the accounts table (SaaS-B1b). scrypt via Node's
 * own crypto module, not a third-party dependency (bcrypt/argon2) - this
 * project has no existing password-hashing convention to follow (the
 * console's only credential today, ADMIN_UI_USERNAME/PASSWORD, is a
 * direct constant-time string comparison against an env var, not a
 * stored hash - lib/auth.ts), and both common alternatives ship native
 * addons, the same class of Alpine/musl build risk already worked through
 * for better-sqlite3 (SaaS-B1a) - not worth taking on twice when Node's
 * built-in is the standard, documented recommendation for this exact
 * use case.
 */
const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH).toString('hex');
  const derivedKey = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  return `${salt}:${derivedKey.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hashHex] = stored.split(':');
  if (!salt || !hashHex) {
    return false;
  }
  const derivedKey = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  const storedKey = Buffer.from(hashHex, 'hex');
  return storedKey.length === derivedKey.length && timingSafeEqual(storedKey, derivedKey);
}
