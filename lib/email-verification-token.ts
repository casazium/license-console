import { randomBytes, createHash } from 'node:crypto';

// Mirrors casazium/license's own lib/activation-token.js exactly - 128
// bits, hex-encoded, only the hash stored at rest.
export function generateEmailVerificationToken(): string {
  return randomBytes(16).toString('hex');
}

export function hashEmailVerificationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
