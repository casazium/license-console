// lib/email/index.ts
//
// Provider selection, mirroring casazium/license's own BILLING_PROVIDER
// pattern (src/lib/config.js / src/app.js) - 'stub' is the only
// implementation that exists; any other value is accepted as a
// recognized config value but fails loudly at the point of use rather
// than silently falling back to the stub, so a real provider (Resend,
// SES, Postmark, etc.) landing later is a config change plus one new
// implementation file, not a caller-facing rewrite.

import type { EmailProvider } from './provider';
import { createStubEmailProvider } from './stub-provider';

const VALID_EMAIL_PROVIDERS = ['stub'];

export function getEmailProvider(): EmailProvider {
  const provider = process.env.EMAIL_PROVIDER || 'stub';

  if (!VALID_EMAIL_PROVIDERS.includes(provider)) {
    throw new Error(
      `Invalid EMAIL_PROVIDER value: ${provider}. Must be one of: ${VALID_EMAIL_PROVIDERS.join(', ')}.`
    );
  }

  if (provider === 'stub') {
    return createStubEmailProvider();
  }

  throw new Error(`EMAIL_PROVIDER=${provider} has no implementation yet.`);
}
