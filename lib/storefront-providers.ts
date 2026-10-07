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

const CASAZIUM_REF_KIND = {
  value: 'metadata' as const,
  label: 'casazium_ref',
  inputLabel: 'casazium_ref value',
  placeholder: 'my-product-ref',
};

export const STOREFRONT_PROVIDERS: Record<StorefrontWebhookProvider, StorefrontProviderInfo> = {
  stripe: {
    label: 'Stripe',
    refKinds: [
      { value: 'payment_link', label: 'Payment Link', inputLabel: 'Payment Link ID', placeholder: 'plink_...' },
      { ...CASAZIUM_REF_KIND, label: 'Metadata (casazium_ref)' },
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
      { value: 'variant', label: 'Variant', inputLabel: 'Variant ID', placeholder: '123456' },
      { ...CASAZIUM_REF_KIND, label: 'Custom data (casazium_ref)' },
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
};

// The order the "Connect ..." buttons appear in.
export const CONNECTABLE_PROVIDERS: StorefrontWebhookProvider[] = ['stripe', 'lemonsqueezy'];

export function providerLabel(provider: string): string {
  return STOREFRONT_PROVIDERS[provider as StorefrontWebhookProvider]?.label ?? provider;
}

const REF_KIND_LABELS: Record<StorefrontMappingRefKind, string> = {
  payment_link: 'Payment Link',
  variant: 'Variant',
  metadata: 'casazium_ref',
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
