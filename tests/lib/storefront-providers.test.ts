import { describe, expect, it } from 'vitest';
import {
  CONNECTABLE_PROVIDERS,
  STOREFRONT_PROVIDERS,
  generateWebhookSecret,
  providerLabel,
  refKindLabel,
} from '@/lib/storefront-providers';

// Per-provider details must match casazium/license's
// storefront-adapters.js (STOREFRONT_REF_KINDS) and
// admin-storefront-webhooks.js (secret bounds) - the server is the real
// check; these pin what the console offers.
describe('lib/storefront-providers', () => {
  it('offers both providers, Stripe first', () => {
    expect(CONNECTABLE_PROVIDERS).toEqual(['stripe', 'lemonsqueezy']);
  });

  it("each provider's ref kinds match the server's", () => {
    expect(STOREFRONT_PROVIDERS.stripe.refKinds.map((k) => k.value)).toEqual(['payment_link', 'metadata']);
    expect(STOREFRONT_PROVIDERS.lemonsqueezy.refKinds.map((k) => k.value)).toEqual(['variant', 'metadata']);
  });

  it('only Lemon Squeezy has a vendor-chosen secret, bounded 16-40, needing License Server 1.7.0', () => {
    expect(STOREFRONT_PROVIDERS.lemonsqueezy).toMatchObject({
      vendorChosenSecret: true,
      secretLength: { min: 16, max: 40 },
      minServerVersion: '1.7.0',
    });
    expect(STOREFRONT_PROVIDERS.stripe.vendorChosenSecret).toBe(false);
    expect(STOREFRONT_PROVIDERS.stripe.secretLength).toBeUndefined();
  });

  it("names each provider's refund event (License Server 1.8.0+)", () => {
    expect(STOREFRONT_PROVIDERS.stripe.refundEvent).toBe('charge.refunded');
    expect(STOREFRONT_PROVIDERS.lemonsqueezy.refundEvent).toBe('order_refunded');
  });

  it('generates 32 lowercase hex characters, inside the 16-40 bounds, different each time', () => {
    const a = generateWebhookSecret();
    const b = generateWebhookSecret();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });

  it('labels providers and ref kinds, falling back to the raw value', () => {
    expect(providerLabel('lemonsqueezy')).toBe('Lemon Squeezy');
    expect(providerLabel('stripe')).toBe('Stripe');
    expect(providerLabel('paddle')).toBe('paddle');
    expect(refKindLabel('variant')).toBe('Variant');
    expect(refKindLabel('payment_link')).toBe('Payment Link');
    expect(refKindLabel('metadata')).toBe('casazium_ref');
    expect(refKindLabel('other')).toBe('other');
  });
});
