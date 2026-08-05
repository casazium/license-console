import crypto from 'node:crypto';

/**
 * AES-256-GCM encryption for this console's own secrets-at-rest (SaaS-B1b:
 * accounts.tenant_api_key_encrypted, the plaintext tenant credential
 * casazium/license's POST /admin/tenants returns exactly once at signup).
 * Same algorithm and wire format as that repo's own src/lib/crypto.js,
 * but a deliberately separate ACCOUNT_ENCRYPTION_KEY, not a shared name/
 * value with that repo's ENCRYPTION_KEY - these are two independently
 * deployable services and reusing one key across both would be an
 * unintended cross-service credential coupling, not a simplification.
 *
 * Unlike that repo's version, no fixed-IV override - always a fresh
 * random IV per call, the strictly safer default with no legacy reason
 * to deviate from it here.
 */
const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const hex = process.env.ACCOUNT_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error('Missing required environment variable: ACCOUNT_ENCRYPTION_KEY');
  }
  const key = Buffer.from(hex, 'hex');
  if (key.length !== 32) {
    throw new Error('ACCOUNT_ENCRYPTION_KEY must be 32 bytes (64 hex characters)');
  }
  return key;
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

export function decrypt(encryptedBase64: string): string {
  const key = getKey();
  const data = Buffer.from(encryptedBase64, 'base64');
  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGO, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
}
