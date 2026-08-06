// lib/email/index.ts
//
// Provider selection, mirroring casazium/license's own BILLING_PROVIDER
// pattern (src/lib/config.js / src/app.js) - any unrecognized value
// fails loudly at the point of use rather than silently falling back to
// the stub, so a new provider landing is a config change plus one new
// implementation file, not a caller-facing rewrite.

import { isMultiTenant } from '../config';
import type { EmailProvider } from './provider';
import { createStubEmailProvider } from './stub-provider';
import { createResendEmailProvider } from './resend-provider';

const VALID_EMAIL_PROVIDERS = ['stub', 'resend'];

export function getEmailProvider(): EmailProvider {
  const rawProvider = process.env.EMAIL_PROVIDER;
  const provider = rawProvider || 'stub';

  if (!VALID_EMAIL_PROVIDERS.includes(provider)) {
    throw new Error(
      `Invalid EMAIL_PROVIDER value: ${provider}. Must be one of: ${VALID_EMAIL_PROVIDERS.join(', ')}.`
    );
  }

  // Security review finding (fresh pre-deployment audit): same reasoning
  // as lib/license-client.ts's getBackendMode() and its own
  // LICENSE_STANDALONE_MODE check - EMAIL_PROVIDER silently defaulting
  // to 'stub' is ambiguous in a production, multi-tenant deployment.
  // Confirmed live: a real Coolify deploy that never sets this var gets
  // a console where password-reset and signup-confirmation silently
  // never send real email, with the real link instead logged in
  // plaintext to container logs - indistinguishable from an operator
  // who deliberately chose the stub for a demo/eval deployment. Require
  // an explicit opt-in (either `resend` for real delivery, or `stub`
  // typed out to confirm that's intentional) in production multi-tenant
  // mode; dev/test/self-hosted keep the zero-config default so `npm run
  // dev` and self-hosted deployments (which never reach these email
  // flows at all) still just work with no .env at all.
  if (process.env.NODE_ENV === 'production' && isMultiTenant() && !rawProvider) {
    throw new Error(
      'EMAIL_PROVIDER is unset in a production, multi-tenant build. Password reset and ' +
        'signup confirmation will silently never send real email otherwise. Set ' +
        'EMAIL_PROVIDER=resend (with RESEND_API_KEY) for real delivery, or explicitly set ' +
        "EMAIL_PROVIDER=stub to confirm that's intentional."
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
