// lib/email/resend-provider.ts
//
// Real EmailProvider implementation against Resend's API
// (https://api.resend.com/emails). Plain fetch, no SDK dependency -
// one endpoint, one call shape, not worth a new package for.

import type { EmailProvider } from './provider';

const RESEND_API_URL = 'https://api.resend.com/emails';

export function createResendEmailProvider(): EmailProvider {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('Missing required environment variable: RESEND_API_KEY');
  }

  // Resend's own documented default for accounts with no verified
  // sending domain yet - only deliverable to the account's own verified
  // address in that case (Resend enforces this on their end, not
  // something this code can or needs to check). Override via EMAIL_FROM
  // once a real domain is verified on the Resend account.
  //
  // Beta-readiness finding: DEPLOYMENT.md previously listed EMAIL_FROM as
  // "optional" for a real SaaS deploy, which meant every signup
  // confirmation and password reset to an actual customer would be
  // silently rejected by Resend's API (the sandbox address only delivers
  // to the account owner) - and since the send failure is intentionally
  // swallowed (see app/api/signup/route.ts's own comment on why), nobody
  // would notice until a locked-out user complained, with no admin reset
  // tool to recover them. Same fail-loud-in-production posture as
  // EMAIL_PROVIDER itself (lib/email/index.ts) rather than a silent
  // fallback to an address that can't reach real users.
  if (process.env.NODE_ENV === 'production' && !process.env.EMAIL_FROM) {
    throw new Error(
      'EMAIL_FROM is unset in a production build with EMAIL_PROVIDER=resend. Resend only ' +
        "delivers from the sandbox default (onboarding@resend.dev) to the account's own " +
        'verified address, not to real customers - signup confirmation and password reset ' +
        'would silently never reach anyone else. Verify a sending domain on the Resend ' +
        'account and set EMAIL_FROM to an address on it (e.g. noreply@yourdomain.com).'
    );
  }
  const from = process.env.EMAIL_FROM || 'onboarding@resend.dev';

  async function send(to: string, subject: string, html: string): Promise<void> {
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ from, to, subject, html }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Resend API responded with ${res.status}: ${body}`);
    }
  }

  return {
    async sendSignupConfirmation(to, confirmUrl) {
      await send(
        to,
        'Confirm your email',
        `<p>Welcome! Click the link below to confirm your email address.</p><p><a href="${confirmUrl}">${confirmUrl}</a></p>`
      );
    },
    async sendPasswordReset(to, resetUrl) {
      await send(
        to,
        'Reset your password',
        `<p>Click the link below to reset your password. If you didn't request this, you can safely ignore this email.</p><p><a href="${resetUrl}">${resetUrl}</a></p>`
      );
    },
  };
}
