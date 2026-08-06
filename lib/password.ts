import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

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
// A hand-rolled wrapper, not promisify(scrypt) - promisify only resolves
// to one of scrypt's overloads, and TypeScript picks the one without an
// options parameter, so the options-aware call site below wouldn't
// type-check under promisify.
function scryptAsync(password: string, salt: string, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

// Security review finding (fresh pre-deployment audit): Node's
// crypto.scrypt() defaults to N=16384 (2^14), which OWASP's current
// Password Storage Cheat Sheet now calls out as insufficient - their
// current minimum recommendation is N=2^17 (131072), r=8, p=1. N=2^14
// was a reasonable default years ago but modern GPU/ASIC cracking
// throughput has moved the goalposts. maxmem must rise to match: scrypt
// needs roughly 128 * N * r bytes of working memory (128 * 131072 * 8 =
// 128MiB here), well above Node's own 32MiB default ceiling, which would
// otherwise reject these params with ERR_CRYPTO_INVALID_SCRYPT_PARAMS.
//
// Safe to change now, not later: this stored format has no versioning
// (just `salt:hashHex`, no embedded cost parameters), so changing N
// after any real account exists would silently break every existing
// user's login - verifyPassword re-derives with today's N, which
// wouldn't match a hash produced under a different one. This repo has
// no real deployed accounts yet (saas-tier's first real Coolify
// deployment is still pending), so this is the one moment to land the
// stronger default for free. If N ever needs to change again after real
// signups exist, the stored format must grow to embed N/r/p per hash
// first - do not just bump this constant at that point.
const SCRYPT_N = 131072;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 256 * 1024 * 1024;
const scryptOptions = { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH).toString('hex');
  const derivedKey = await scryptAsync(password, salt, KEY_LENGTH, scryptOptions);
  return `${salt}:${derivedKey.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hashHex] = stored.split(':');
  if (!salt || !hashHex) {
    return false;
  }
  const derivedKey = await scryptAsync(password, salt, KEY_LENGTH, scryptOptions);
  const storedKey = Buffer.from(hashHex, 'hex');
  return storedKey.length === derivedKey.length && timingSafeEqual(storedKey, derivedKey);
}
