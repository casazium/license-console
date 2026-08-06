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
// throughput has moved the goalposts.
//
// These are the parameters used for every NEW hash - see
// STORED_FORMAT_VERSION below for why an *existing* hash's own embedded
// params, not these, are what verifyPassword() actually uses.
const SCRYPT_N = 131072;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

// scrypt needs roughly 128 * N * r bytes of working memory (128 *
// 131072 * 8 = 128MiB at the current defaults above), well above Node's
// own 32MiB default ceiling, which would otherwise reject these params
// with ERR_CRYPTO_INVALID_SCRYPT_PARAMS. Computed per-call from the
// N/r actually in use (not just the current constants above) so a
// verifyPassword() call against an old, lower-cost hash doesn't demand
// more memory than that hash's own params ever needed - and so a
// possible future increase to SCRYPT_N doesn't silently need a matching
// manual bump here too.
function scryptOptionsFor(N: number, r: number, p: number): ScryptOptions {
  return { N, r, p, maxmem: Math.ceil(128 * N * r * 1.1) };
}

// Security review finding (third-party audit, R3-CONSOLE-M2): the
// stored format used to be plain `salt:hashHex`, with the cost
// parameters (N/r/p) never recorded anywhere - verifyPassword() always
// re-derived using whatever SCRYPT_N/R/P happened to be hardcoded at
// verification time. That meant changing those constants after any real
// account existed would silently break every existing user's login
// (verifyPassword re-deriving under new params against a hash produced
// under the old ones never matches) - a real, load-bearing reason this
// file's own comment used to warn "do not just bump this constant"
// rather than actually fixing the format. Encoding N/r/p directly in
// each stored hash (mirrors the shape PHC-format hashes like bcrypt/
// argon2 use, though not that literal spec) means a *future* cost
// increase only changes what NEW hashes use - every previously-issued
// hash keeps verifying correctly forever under its own original
// parameters, no migration, no forced mass password reset.
//
// 6 '$'-separated fields: a literal 'scrypt' tag (so a stray legacy
// `salt:hashHex` string - none exist in any real deployment yet, but
// still - fails the parse below rather than being silently
// misinterpreted), N, r, p, salt, hash.
const FORMAT_TAG = 'scrypt';

function encodeHash(N: number, r: number, p: number, salt: string, hashHex: string): string {
  return [FORMAT_TAG, N, r, p, salt, hashHex].join('$');
}

function decodeHash(
  stored: string
): { N: number; r: number; p: number; salt: string; hashHex: string } | null {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== FORMAT_TAG) {
    return null;
  }
  const [, nStr, rStr, pStr, salt, hashHex] = parts;
  const N = Number.parseInt(nStr, 10);
  const r = Number.parseInt(rStr, 10);
  const p = Number.parseInt(pStr, 10);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p) || !salt || !hashHex) {
    return null;
  }
  return { N, r, p, salt, hashHex };
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH).toString('hex');
  const derivedKey = await scryptAsync(password, salt, KEY_LENGTH, scryptOptionsFor(SCRYPT_N, SCRYPT_R, SCRYPT_P));
  return encodeHash(SCRYPT_N, SCRYPT_R, SCRYPT_P, salt, derivedKey.toString('hex'));
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const decoded = decodeHash(stored);
  if (!decoded) {
    return false;
  }
  const { N, r, p, salt, hashHex } = decoded;
  const derivedKey = await scryptAsync(password, salt, KEY_LENGTH, scryptOptionsFor(N, r, p));
  const storedKey = Buffer.from(hashHex, 'hex');
  return storedKey.length === derivedKey.length && timingSafeEqual(storedKey, derivedKey);
}

// Exported so lib/auth.ts's DUMMY_PASSWORD_HASH (the fixed, non-secret
// decoy verifyCredentials() checks a nonexistent account against, to
// keep that cost constant regardless of whether the account is real -
// see that file's own comment) stays in the same format verifyPassword()
// actually parses, rather than hand-duplicating N/r/p/lengths in a
// second file that would silently drift out of sync with this one.
export const DUMMY_PASSWORD_HASH = encodeHash(SCRYPT_N, SCRYPT_R, SCRYPT_P, '0'.repeat(SALT_LENGTH * 2), '0'.repeat(KEY_LENGTH * 2));
