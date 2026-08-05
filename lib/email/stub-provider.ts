// lib/email/stub-provider.ts
//
// Stub EmailProvider (mirrors casazium/license's lib/billing/stub-provider.js) -
// implements provider.ts's interface with no real send. Logs the message
// server-side instead, so the whole signup -> confirm round trip is
// exercisable and testable end-to-end without a real email account, the
// same way stub billing let checkout/webhook logic be built and tested
// before any real Stripe keys existed.

import type { EmailProvider } from './provider';

export function createStubEmailProvider(): EmailProvider {
  return {
    async sendSignupConfirmation(to, confirmUrl) {
      console.log(`[stub-email] Signup confirmation for ${to}: ${confirmUrl}`);
    },
    async sendPasswordReset(to, resetUrl) {
      console.log(`[stub-email] Password reset for ${to}: ${resetUrl}`);
    },
  };
}
