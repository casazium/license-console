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

  /**
   * Account-settings email change (BETA_LAUNCH_STATUS.md §4). Sent to
   * the NEW address, not the account's current one - the account's
   * email only actually changes once this link is clicked (see
   * app/api/change-email/route.ts and verify-email/route.ts's new_email
   * branch), so a typo'd new address just leaves an unredeemed token
   * rather than losing the account's real one.
   */
  sendEmailChangeConfirmation(to: string, confirmUrl: string): Promise<void>;

  /**
   * Best-effort notice to the OLD address once an email change has
   * already taken effect - not a confirmation step, nothing to click.
   * Exists so a change made from a hijacked session at least leaves a
   * trace somewhere the real owner might still read, the same
   * "shouldn't be silent" reasoning every other sensitive account
   * action on this page already gets (password re-entry, the rotation/
   * deletion warning copy).
   */
  sendEmailChangeNotice(to: string, newEmail: string): Promise<void>;
}
