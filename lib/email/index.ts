// lib/email/index.ts
//
// Provider selection, mirroring casazium/license's own BILLING_PROVIDER
// pattern (src/lib/config.js / src/app.js) - any unrecognized value
// fails loudly at the point of use rather than silently falling back to
// the stub, so a new provider landing is a config change plus one new
// implementation file, not a caller-facing rewrite.

import type { EmailProvider } from './provider';
import { createStubEmailProvider } from './stub-provider';
import { createResendEmailProvider } from './resend-provider';

const VALID_EMAIL_PROVIDERS = ['stub', 'resend'];

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

  if (provider === 'resend') {
    return createResendEmailProvider();
  }

  throw new Error(`EMAIL_PROVIDER=${provider} has no implementation yet.`);
}
