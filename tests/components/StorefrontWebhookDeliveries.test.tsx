// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { StorefrontWebhookDeliveries } from '@/app/(app)/settings/StorefrontWebhookDeliveries';
import type { StorefrontDelivery } from '@/lib/license-client';

const listDeliveriesAction = vi.fn();

vi.mock('@/app/(app)/settings/actions', () => ({
  listStorefrontDeliveriesAction: (...args: unknown[]) => listDeliveriesAction(...args),
}));

function renderWithMantine(ui: ReactElement) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

// Old enough that an unsent email would count as stuck.
const AN_HOUR_AGO = new Date(Date.now() - 60 * 60 * 1000).toISOString();

function delivery(overrides: Partial<StorefrontDelivery>): StorefrontDelivery {
  return {
    tenant_id: 't',
    checkout_session_id: `cs_${Math.random().toString(36).slice(2)}`,
    outcome: 'issued',
    attempts: 1,
    license_key: 'KEY-1',
    delivery_status: 'sent',
    processed_at: AN_HOUR_AGO,
    ...overrides,
  };
}

async function showDeliveries(deliveries: StorefrontDelivery[]) {
  listDeliveriesAction.mockResolvedValueOnce({ ok: true, data: { deliveries, hasMore: false } });
  renderWithMantine(<StorefrontWebhookDeliveries webhookId="wh_1" provider="stripe" active={true} />);
  await screen.findByText(deliveries[0].checkout_session_id);
}

describe('StorefrontWebhookDeliveries - refunds (License Server 1.8.0+)', () => {
  it.each([
    [{ refund_kind: 'full', refund_action: 'revoked' }, 'Refunded · revoked'],
    [{ refund_kind: 'full', refund_action: 'recorded' }, 'Refunded · kept'],
    [{ refund_kind: 'full', refund_action: 'already_revoked' }, 'Refunded · revoked'],
    [{ refund_kind: 'full', refund_action: 'revoke_failed' }, 'Revoke by hand'],
    [{ refund_kind: 'partial', refund_action: 'recorded' }, 'Partly refunded'],
  ] as const)('shows what a refund did: %o -> %s', async (refund, label) => {
    await showDeliveries([delivery(refund)]);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('shows when, and for a partial refund how much as a percentage (no currency is known)', async () => {
    await showDeliveries([
      delivery({ refund_kind: 'partial', refund_action: 'recorded', refunded_amount: 980, amount_total: 4900, refunded_at: '2026-10-06 12:00:00' }),
    ]);
    expect(screen.getByText('20% refunded · 2026-10-06')).toBeInTheDocument();
  });

  it('shows the date of a full refund', async () => {
    await showDeliveries([delivery({ refund_kind: 'full', refund_action: 'revoked', refunded_at: '2026-10-05 23:30:00' })]);
    expect(screen.getByText('2026-10-05')).toBeInTheDocument();
  });

  it('labels a purchase refunded before its license was issued', async () => {
    await showDeliveries([delivery({ outcome: 'refunded_before_issue', license_key: null, refund_kind: 'full', refund_action: 'no_license' })]);
    expect(screen.getByText('Refunded first')).toBeInTheDocument();
    // The outcome says it; no second, redundant refund badge.
    expect(screen.queryByText('Refunded')).not.toBeInTheDocument();
  });

  it('never flags a fully refunded purchase as a stuck email - it is deliberately not sent', async () => {
    await showDeliveries([delivery({ delivery_status: 'pending', refund_kind: 'full', refund_action: 'revoked' })]);
    expect(screen.queryByText('Needs attention')).not.toBeInTheDocument();
  });

  it('still flags an unrefunded purchase whose email is stuck', async () => {
    await showDeliveries([delivery({ delivery_status: 'pending' })]);
    expect(screen.getAllByText('Needs attention').length).toBeGreaterThan(0);
  });

  it('shows no refund badge for a purchase with no refund (or from an older server)', async () => {
    await showDeliveries([delivery({})]);
    expect(screen.queryByText(/refunded/i)).not.toBeInTheDocument();
  });
});

describe('StorefrontWebhookDeliveries - subscriptions (License Server 1.9.0+)', () => {
  it.each([
    [{ subscription_state: 'active', subscription_paid_through: '2026-11-06T00:00:00.000Z' }, 'Subscribed', 'Paid to 2026-11-06'],
    [{ subscription_state: 'trialing', subscription_paid_through: null }, 'Trial', null],
    [{ subscription_state: 'past_due', subscription_paid_through: '2026-11-06T00:00:00.000Z' }, 'Payment due', 'Paid to 2026-11-06'],
    [{ subscription_state: 'ending', subscription_ends_at: '2026-11-06T00:00:00.000Z' }, 'Cancelled', 'Ends 2026-11-06'],
    [{ subscription_state: 'ended', subscription_paid_through: '2026-10-06T00:00:00.000Z', subscription_ends_at: '2026-10-09T00:00:00.000Z' }, 'Lapsed', 'Lapsed 2026-10-09'],
    [{ subscription_state: 'past_due', subscription_paid_through: '2026-10-06T00:00:00.000Z', subscription_ends_at: '2026-10-10T00:00:00.000Z' }, 'Payment due', 'Ends 2026-10-10'],
    [{ subscription_state: null, subscription_paid_through: null }, 'Subscription', null],
    [{ subscription_state: 'terminal', subscription_ends_at: '2026-11-06T00:00:00.000Z' }, 'Ended', 'Ended 2026-11-06'],
  ] as const)('shows a subscription: %o -> %s / %s', async (fields, label, line) => {
    await showDeliveries([delivery({ subscription_id: 'sub_1', ...fields })]);
    expect(screen.getByText(label)).toBeInTheDocument();
    if (line) expect(screen.getByText(line)).toBeInTheDocument();
  });

  it('shows nothing for a one-time purchase', async () => {
    await showDeliveries([delivery({ subscription_id: null })]);
    for (const label of ['Subscribed', 'Subscription', 'No payments yet']) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
  });

  it('flags a subscription purchase with no payments, and explains which events to enable', async () => {
    await showDeliveries([delivery({ subscription_id: 'sub_1', subscription_events_missing: true })]);
    expect(screen.getByText('No payments yet')).toBeInTheDocument();
    expect(screen.getByText('Subscription payments not received')).toBeInTheDocument();
    expect(screen.getByText('invoice.paid')).toBeInTheDocument();
    expect(screen.getByText(/provisional expiry/)).toBeInTheDocument();
  });

  it('Lemon Squeezy: the flag names its payment events and says the license will not extend', async () => {
    const row = delivery({ subscription_id: 'sub_1', subscription_events_missing: true });
    listDeliveriesAction.mockResolvedValueOnce({ ok: true, data: { deliveries: [row], hasMore: false } });
    renderWithMantine(<StorefrontWebhookDeliveries webhookId="wh_1" provider="lemonsqueezy" active={true} />);
    await screen.findByText(row.checkout_session_id);
    expect(screen.getByText('subscription_payment_success')).toBeInTheDocument();
    expect(screen.getByText(/won't extend/)).toBeInTheDocument();
  });

  it('no flag when payments are arriving', async () => {
    await showDeliveries([delivery({ subscription_id: 'sub_1', subscription_state: 'active', subscription_events_missing: false })]);
    expect(screen.queryByText('Subscription payments not received')).not.toBeInTheDocument();
  });

  it('more than one flagged purchase: the alert speaks of their licenses', async () => {
    await showDeliveries([
      delivery({ subscription_id: 'sub_1', subscription_events_missing: true }),
      delivery({ subscription_id: 'sub_2', subscription_events_missing: true }),
    ]);
    expect(screen.getByText(/2 subscription purchases have/)).toBeInTheDocument();
    expect(screen.getByText(/their licenses are on short provisional expiries/)).toBeInTheDocument();
    expect(screen.getAllByText('No payments yet')).toHaveLength(2);
  });

  it('sits alongside the refund and needs-attention badges', async () => {
    await showDeliveries([
      delivery({
        subscription_id: 'sub_1',
        subscription_state: 'terminal',
        subscription_ends_at: '2026-10-09T00:00:00.000Z',
        refund_kind: 'full',
        refund_action: 'revoked',
      }),
      delivery({ subscription_id: 'sub_2', subscription_state: 'active', delivery_status: 'pending' }),
    ]);
    expect(screen.getByText('Ended')).toBeInTheDocument();
    expect(screen.getByText('Ended 2026-10-09')).toBeInTheDocument();
    expect(screen.getByText('Refunded · revoked')).toBeInTheDocument();
    expect(screen.getByText('Subscribed')).toBeInTheDocument();
    // The stuck-email alert's title and the row's own badge.
    expect(screen.getAllByText('Needs attention')).toHaveLength(2);
  });
});
