// Per-provider display and setup details for the storefront webhooks
// section - one place, so the connect button, setup steps, mapping form
// and deliveries help never disagree about a provider. Mirrors
// casazium/license's storefront-adapters.js (STOREFRONT_REF_KINDS) and
// admin-storefront-webhooks.js (secret length bounds).
import type { StorefrontMappingRefKind, StorefrontWebhookProvider } from '@/lib/license-types';

export type StorefrontProviderInfo = {
  label: string;
  // Ref kinds the server accepts for this provider, default first.
  refKinds: { value: StorefrontMappingRefKind; label: string; inputLabel: string; placeholder: string }[];
  // Lemon Squeezy has the vendor choose the signing secret; Stripe
  // generates its own and shows it after the endpoint is added.
  vendorChosenSecret: boolean;
  // Enforced by the server too (400) - checked here only to fail fast.
  secretLength?: { min: number; max: number };
  secretPrefix?: string;
  // Paddle: chosen when connecting (its payloads don't say), and the
  // webhook needs an API key to fetch each buyer's email.
  needsEnvironment?: boolean;
  needsApiKey?: boolean;
  // The event that reports a refund (License Server 1.8.0+).
  refundEvent: string;
  // The events subscriptions need (License Server 1.9.0+), all of them
  // together - on Lemon Squeezy, the payment events above all: without
  // them a subscription never extends.
  subscriptionEvents: string[];
  // The License Server release that first accepts this provider, when
  // it's newer than MIN_COMPATIBLE_SERVER_VERSION (lib/version.ts). A
  // console pointed at an older server gets a 400 on connect, which the
  // live client turns into a message naming this version.
  minServerVersion?: string;
};

export const STOREFRONT_PROVIDERS: Record<StorefrontWebhookProvider, StorefrontProviderInfo> = {
  stripe: {
    label: 'Stripe',
    refKinds: [
      { value: 'payment_link', label: 'Payment Link', inputLabel: 'Payment Link ID', placeholder: 'plink_...' },
      { value: 'metadata', label: 'Metadata (casazium_ref)', inputLabel: 'casazium_ref value', placeholder: 'my-product-ref' },
    ],
    vendorChosenSecret: false,
    refundEvent: 'charge.refunded',
    subscriptionEvents: [
      'invoice.paid',
      'customer.subscription.created',
      'customer.subscription.updated',
      'customer.subscription.deleted',
    ],
  },
  lemonsqueezy: {
    label: 'Lemon Squeezy',
    refKinds: [
      // Variant only: a buyer can add custom data to any checkout link,
      // so a casazium_ref can't say what they bought (casazium/license#53).
      { value: 'variant', label: 'Variant', inputLabel: 'Variant ID', placeholder: '123456' },
    ],
    vendorChosenSecret: true,
    secretLength: { min: 16, max: 40 },
    minServerVersion: '1.7.0',
    refundEvent: 'order_refunded',
    subscriptionEvents: [
      'subscription_created',
      'subscription_updated',
      'subscription_cancelled',
      'subscription_resumed',
      'subscription_expired',
      'subscription_paused',
      'subscription_unpaused',
      'subscription_payment_success',
      'subscription_payment_recovered',
    ],
  },
  paddle: {
    label: 'Paddle',
    refKinds: [
      { value: 'price', label: 'Price', inputLabel: 'Paddle price ID', placeholder: 'pri_...' },
      { value: 'product', label: 'Product', inputLabel: 'Paddle product ID', placeholder: 'pro_...' },
      // Trusted only on transactions created through Paddle's API: Paddle.js
      // lets a buyer set custom data in their browser.
      { value: 'metadata', label: 'casazium_ref (API checkouts)', inputLabel: 'casazium_ref value', placeholder: 'my-product-ref' },
    ],
    vendorChosenSecret: false,
    secretLength: { min: 64, max: 128 },
    secretPrefix: 'pdl_ntfset_',
    needsEnvironment: true,
    needsApiKey: true,
    minServerVersion: '1.11.0',
    refundEvent: 'adjustment.updated',
    subscriptionEvents: [
      'subscription.created',
      'subscription.activated',
      'subscription.updated',
      'subscription.trialing',
      'subscription.past_due',
      'subscription.paused',
      'subscription.resumed',
      'subscription.canceled',
    ],
  },
};

// The order the "Connect ..." buttons appear in.
export const CONNECTABLE_PROVIDERS: StorefrontWebhookProvider[] = ['stripe', 'lemonsqueezy', 'paddle'];

// What a Paddle webhook's api_key_problem means, and what to do.
export const API_KEY_PROBLEM_TEXT: Record<string, { title: string; body: string; color: 'red' | 'yellow' }> = {
  key_rejected: { title: 'Paddle refused the API key', body: 'Licenses still issue, but their emails wait. Create a new key with Customers: read and save it below, then send the pending deliveries.', color: 'red' },
  no_api_key: { title: 'No API key saved', body: 'Licenses still issue, but their emails wait. Save a key with Customers: read below, then send the pending deliveries.', color: 'red' },
  key_unreadable: { title: "The saved API key can't be read", body: 'Save the key again below, then send the pending deliveries.', color: 'red' },
  key_revoked: { title: 'The API key was revoked in Paddle', body: 'Licenses still issue, but their emails wait. Create a new key with Customers: read and save it below, then send the pending deliveries.', color: 'red' },
  key_expired: { title: 'The API key has expired', body: 'Licenses still issue, but their emails wait. Create a new key with Customers: read and save it below, then send the pending deliveries.', color: 'red' },
  key_expiring: { title: 'The API key expires soon', body: 'Create a new key with Customers: read and save it below before it does.', color: 'yellow' },
  customer_not_found: { title: "Paddle couldn't find some buyers", body: "This usually means the webhook's environment doesn't match the Paddle account sending to it (sandbox vs live). Check which notification destination points here.", color: 'yellow' },
};

export function providerLabel(provider: string): string {
  return STOREFRONT_PROVIDERS[provider as StorefrontWebhookProvider]?.label ?? provider;
}

// A Paddle API key's environment from its prefix, or null if it isn't one
// (Paddle's documented format; the server checks it again, and with Paddle).
export function paddleKeyEnvironment(apiKey: string): 'sandbox' | 'live' | null {
  const match = /^pdl_(live|sdbx)_apikey_[a-z\d]{26}_[a-zA-Z\d]{22}_[a-zA-Z\d]{3}$/.exec(apiKey);
  if (!match) return null;
  return match[1] === 'live' ? 'live' : 'sandbox';
}

const REF_KIND_LABELS: Record<StorefrontMappingRefKind, string> = {
  payment_link: 'Payment Link',
  variant: 'Variant',
  metadata: 'casazium_ref',
  price: 'Price',
  product: 'Product',
};

export function refKindLabel(refKind: string): string {
  return REF_KIND_LABELS[refKind as StorefrontMappingRefKind] ?? refKind;
}

// 32 hex characters (128 bits) from the browser's CSPRNG - inside Lemon
// Squeezy's 6-40 and the server's 16-40.
export function generateWebhookSecret(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
