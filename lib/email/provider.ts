// lib/email/provider.ts
//
// The EmailProvider interface, mirroring casazium/license's own
// lib/billing/provider.js pattern (BillingProvider, SaaS-A5): no runtime
// logic here, just the shape every implementation matches, selected via
// config (lib/email/index.ts) with zero caller changes. Same reasoning
// applies - build the real interface and call sites now, against a stub
// that logs instead of sending, so a real provider (Resend, SES,
// Postmark, etc.) is a config change plus one new implementation file,
// not a rewrite of signup/verification.

export interface EmailProvider {
  /**
   * Sends the signup confirmation email. confirmUrl is a complete,
   * ready-to-click link (already carries the one-time verification
   * token) - the provider implementation doesn't need to know anything
   * about tokens or accounts, only how to deliver a message.
   */
  sendSignupConfirmation(to: string, confirmUrl: string): Promise<void>;

  /**
   * Sends the password-reset email. resetUrl is a complete,
   * ready-to-click link carrying the one-time reset token - same
   * "provider doesn't know about tokens" shape as sendSignupConfirmation.
   */
  sendPasswordReset(to: string, resetUrl: string): Promise<void>;
}
