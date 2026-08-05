'use server';

import { createCheckoutSession, completeStubCheckout } from '@/lib/license-client';
import { isRateLimited } from '@/lib/errors';
import { requireSessionWithTenantKey, markIfTenantRejected } from '@/lib/tenant-context';
import type { BillingStatus } from '@/lib/license-types';

type ActionResult<T> = { ok: true; data: T } | { ok: false; reason: 'rate-limited' };

// The stub billing provider (casazium/license's src/lib/billing/stub-provider.js)
// deliberately returns an unreachable URL - there's no real external
// checkout to send a tenant to yet. Recognized by hostname rather than
// hardcoded everywhere: once a real provider lands, its checkout session
// returns a real (different) URL and this branch simply stops firing -
// no code here needs to change or be removed for that swap-in.
const STUB_CHECKOUT_HOST = 'stub-billing.invalid';

export async function createCheckoutSessionAction(plan: string): Promise<ActionResult<{ url: string }>> {
  const { identity, tenantApiKey } = await requireSessionWithTenantKey();
  try {
    const session = await createCheckoutSession(plan, tenantApiKey);
    if (new URL(session.url).hostname === STUB_CHECKOUT_HOST) {
      return { ok: true, data: { url: `/billing/checkout/confirm?plan=${encodeURIComponent(plan)}` } };
    }
    return { ok: true, data: session };
  } catch (err) {
    if (isRateLimited(err)) return { ok: false, reason: 'rate-limited' };
    markIfTenantRejected(err, identity.tenantId);
    throw err;
  }
}

// Backs the in-app demo checkout confirmation page (app/(app)/billing/checkout/confirm) -
// does what a real Stripe webhook's subscription_updated event eventually
// will. Only reachable at all while the server's own BILLING_PROVIDER is
// 'stub' (POST /billing/complete-stub-checkout 404s otherwise); this
// console has no way to tell which mode the server is in ahead of time,
// so a real-provider deployment would only ever reach this action via
// the confirm page above, which itself is only ever navigated to when
// createCheckoutSessionAction detected the stub's own unreachable URL.
export async function completeStubCheckoutAction(plan: string): Promise<ActionResult<BillingStatus>> {
  const { identity, tenantApiKey } = await requireSessionWithTenantKey();
  try {
    const status = await completeStubCheckout(plan, tenantApiKey);
    return { ok: true, data: status };
  } catch (err) {
    if (isRateLimited(err)) return { ok: false, reason: 'rate-limited' };
    markIfTenantRejected(err, identity.tenantId);
    throw err;
  }
}
