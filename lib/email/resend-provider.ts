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
