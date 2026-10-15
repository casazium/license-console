// @vitest-environment jsdom
// The open storefront webhook survives a page refresh (it lives in the
// URL as ?webhook=<id>), and Deliveries can be reloaded in place - so
// seeing new purchases doesn't mean reopening the webhook each time.
import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StorefrontWebhooksSection } from '@/app/(app)/settings/StorefrontWebhooksSection';
import type { StorefrontDelivery, StorefrontWebhook } from '@/lib/license-client';

let searchParams = new URLSearchParams();
vi.mock('next/navigation', () => ({ useSearchParams: () => searchParams }));

const listDeliveriesAction = vi.fn();
vi.mock('@mantine/notifications', () => ({ notifications: { show: vi.fn() } }));
vi.mock('@/lib/notify', () => ({ notifyRateLimited: vi.fn() }));
vi.mock('@/app/(app)/settings/actions', () => ({
  createStorefrontWebhookAction: vi.fn(),
  setStorefrontWebhookSecretAction: vi.fn(),
  setStorefrontWebhookApiKeyAction: vi.fn(),
  sendStorefrontPendingDeliveriesAction: vi.fn(),
  setStorefrontRefundPolicyAction: vi.fn(),
  setStorefrontSubscriptionGraceAction: vi.fn(),
  disableStorefrontWebhookAction: vi.fn(),
  listStorefrontMappingsAction: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  createStorefrontMappingAction: vi.fn(),
  deleteStorefrontMappingAction: vi.fn(),
  listStorefrontDeliveriesAction: (...args: unknown[]) => listDeliveriesAction(...args),
}));

function renderWithMantine(ui: ReactElement) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

const webhook = (id: string, provider: StorefrontWebhook['provider']): StorefrontWebhook => ({
  id,
  provider,
  status: 'active',
  created_at: '2026-10-15T00:00:00Z',
  last_event_at: null,
});
const WEBHOOKS = [webhook('wh_stripe', 'stripe'), webhook('wh_ls', 'lemonsqueezy')];

const delivery = (id: string): StorefrontDelivery =>
  ({
    tenant_id: 't',
    checkout_session_id: id,
    outcome: 'issued',
    attempts: 1,
    license_key: null,
    delivery_status: 'sent',
    processed_at: '2026-10-15 12:00:00',
  }) as StorefrontDelivery;

beforeEach(() => {
  searchParams = new URLSearchParams();
  window.history.replaceState(null, '', '/settings');
  listDeliveriesAction.mockResolvedValue({ ok: true, data: { deliveries: [], hasMore: false } });
});

afterEach(() => {
  listDeliveriesAction.mockReset();
});

describe('the open webhook is kept in the URL', () => {
  it('opens the webhook named in ?webhook= on first render', async () => {
    searchParams = new URLSearchParams('webhook=wh_ls');
    renderWithMantine(<StorefrontWebhooksSection initialWebhooks={WEBHOOKS} apiBaseUrl="" />);
    await waitFor(() => expect(listDeliveriesAction).toHaveBeenCalledWith('wh_ls', expect.anything()));
    expect(listDeliveriesAction).not.toHaveBeenCalledWith('wh_stripe', expect.anything());
  });

  it("ignores an id that isn't one of this account's webhooks", async () => {
    searchParams = new URLSearchParams('webhook=wh_someone_else');
    renderWithMantine(<StorefrontWebhooksSection initialWebhooks={WEBHOOKS} apiBaseUrl="" />);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(listDeliveriesAction).not.toHaveBeenCalled();
  });

  it('opening a webhook writes it to the URL, and closing it removes it, without adding history', async () => {
    const lengthBefore = window.history.length;
    renderWithMantine(<StorefrontWebhooksSection initialWebhooks={WEBHOOKS} apiBaseUrl="" />);
    fireEvent.click(screen.getByRole('button', { name: /Stripe/ }));
    await waitFor(() => expect(new URL(window.location.href).searchParams.get('webhook')).toBe('wh_stripe'));
    fireEvent.click(screen.getByRole('button', { name: /Stripe/ }));
    await waitFor(() => expect(new URL(window.location.href).searchParams.has('webhook')).toBe(false));
    expect(window.history.length).toBe(lengthBefore);
  });
});

describe('Deliveries can be refreshed in place', () => {
  it('Refresh reloads the list and shows a new purchase', async () => {
    searchParams = new URLSearchParams('webhook=wh_stripe');
    listDeliveriesAction
      .mockResolvedValueOnce({ ok: true, data: { deliveries: [delivery('cs_first')], hasMore: false } })
      .mockResolvedValueOnce({ ok: true, data: { deliveries: [delivery('cs_new'), delivery('cs_first')], hasMore: false } });
    renderWithMantine(<StorefrontWebhooksSection initialWebhooks={WEBHOOKS} apiBaseUrl="" />);
    expect(await screen.findByText('cs_first')).toBeInTheDocument();
    expect(screen.queryByText('cs_new')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('cs_new')).toBeInTheDocument();
    expect(listDeliveriesAction).toHaveBeenCalledTimes(2);
    expect(listDeliveriesAction).toHaveBeenLastCalledWith('wh_stripe', { limit: expect.any(Number), offset: 0 });
  });
});
