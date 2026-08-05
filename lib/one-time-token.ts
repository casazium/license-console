import { randomBytes, createHash } from 'node:crypto';

// Generic one-time-token generate/hash pair - mirrors casazium/license's
// own lib/activation-token.js exactly (128 bits, hex-encoded, only the
// hash stored at rest). Shared by every one-time-link flow in this repo
// (signup confirmation, password reset) rather than duplicated per
// flow - the logic is identical, only the token's storage table and
// expiry window differ per use.
export function generateOneTimeToken(): string {
  return randomBytes(16).toString('hex');
}

export function hashOneTimeToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
