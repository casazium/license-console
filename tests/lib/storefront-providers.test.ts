import { describe, expect, it } from 'vitest';
import {
  CONNECTABLE_PROVIDERS,
  STOREFRONT_PROVIDERS,
  generateWebhookSecret,
  paddleKeyEnvironment,
  providerLabel,
  refKindLabel,
} from '@/lib/storefront-providers';

// Per-provider details must match casazium/license's
// storefront-adapters.js (STOREFRONT_REF_KINDS) and
// admin-storefront-webhooks.js (secret bounds) - the server is the real
// check; these pin what the console offers.
describe('lib/storefront-providers', () => {
  it('offers all three providers, Stripe first', () => {
    expect(CONNECTABLE_PROVIDERS).toEqual(['stripe', 'lemonsqueezy', 'paddle']);
  });

  it("each provider's ref kinds match the server's", () => {
    expect(STOREFRONT_PROVIDERS.stripe.refKinds.map((k) => k.value)).toEqual(['payment_link', 'metadata']);
    // Variant only: buyers can edit Lemon Squeezy custom data (casazium/license#53).
    expect(STOREFRONT_PROVIDERS.lemonsqueezy.refKinds.map((k) => k.value)).toEqual(['variant']);
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
    expect(providerLabel('paddle')).toBe('Paddle');
    expect(providerLabel('gumroad')).toBe('gumroad');
    expect(refKindLabel('price')).toBe('Price');
    expect(refKindLabel('product')).toBe('Product');
    expect(refKindLabel('variant')).toBe('Variant');
    expect(refKindLabel('payment_link')).toBe('Payment Link');
    expect(refKindLabel('metadata')).toBe('casazium_ref');
    expect(refKindLabel('other')).toBe('other');
  });

  // Mirrors casazium/license 1.9.0's API.md §7a: every event the server's
  // subscription handling acts on, per provider.
  it('lists the subscription events each provider needs, Lemon Squeezy including both payment events', () => {
    expect(STOREFRONT_PROVIDERS.stripe.subscriptionEvents).toEqual([
      'invoice.paid',
      'customer.subscription.created',
      'customer.subscription.updated',
      'customer.subscription.deleted',
    ]);
    expect(STOREFRONT_PROVIDERS.lemonsqueezy.subscriptionEvents).toEqual([
      'subscription_created',
      'subscription_updated',
      'subscription_cancelled',
      'subscription_resumed',
      'subscription_expired',
      'subscription_paused',
      'subscription_unpaused',
      'subscription_payment_success',
      'subscription_payment_recovered',
    ]);
  });

  it("Paddle's setup matches the server (License Server 1.11.0)", () => {
    const paddle = STOREFRONT_PROVIDERS.paddle;
    expect(paddle.refKinds.map((k) => k.value)).toEqual(['price', 'product', 'metadata']);
    expect(paddle).toMatchObject({
      vendorChosenSecret: false,
      secretLength: { min: 64, max: 128 },
      secretPrefix: 'pdl_ntfset_',
      needsEnvironment: true,
      needsApiKey: true,
      minServerVersion: '1.11.0',
      refundEvent: 'adjustment.updated',
    });
    expect(paddle.subscriptionEvents).toContain('subscription.canceled');
  });

  it("reads a Paddle API key's environment from its prefix, and refuses anything else", () => {
    const key = (env: string) => `pdl_${env}_apikey_01m4xapsjdq2ac7r5ke66my10d_${'K'.repeat(22)}_abc`;
    expect(paddleKeyEnvironment(key('sdbx'))).toBe('sandbox');
    expect(paddleKeyEnvironment(key('live'))).toBe('live');
    expect(paddleKeyEnvironment('a'.repeat(50))).toBeNull();
    expect(paddleKeyEnvironment('pdl_sdbx_apikey_short')).toBeNull();
  });
});
