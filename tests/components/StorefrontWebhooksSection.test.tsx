// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StorefrontWebhooksSection } from '@/app/(app)/settings/StorefrontWebhooksSection';
import type { StorefrontWebhook } from '@/lib/license-client';

const createWebhookAction = vi.fn();
const setSecretAction = vi.fn();
const setRefundPolicyAction = vi.fn();

vi.mock('@/app/(app)/settings/actions', () => ({
  createStorefrontWebhookAction: (...args: unknown[]) => createWebhookAction(...args),
  setStorefrontWebhookSecretAction: (...args: unknown[]) => setSecretAction(...args),
  setStorefrontRefundPolicyAction: (...args: unknown[]) => setRefundPolicyAction(...args),
  disableStorefrontWebhookAction: vi.fn(),
  listStorefrontMappingsAction: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  createStorefrontMappingAction: vi.fn(),
  deleteStorefrontMappingAction: vi.fn(),
  listStorefrontDeliveriesAction: vi.fn().mockResolvedValue({ ok: true, data: { deliveries: [], hasMore: false } }),
}));

function renderWithMantine(ui: ReactElement) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

function pendingWebhook(provider: StorefrontWebhook['provider']): StorefrontWebhook {
  return { id: `wh_${provider}`, provider, status: 'pending', created_at: '2026-10-05T00:00:00Z', last_event_at: null };
}

async function openLemonSqueezySetup() {
  renderWithMantine(
    <StorefrontWebhooksSection initialWebhooks={[pendingWebhook('lemonsqueezy')]} apiBaseUrl="https://l.example.test/v1" />
  );
  fireEvent.click(screen.getByRole('button', { name: /Lemon Squeezy/ }));
  // Wait until the opening accordion panel is accessible, not just rendered.
  await screen.findByRole('button', { name: 'Save secret' });
  return screen.getByLabelText(/Signing secret/);
}

describe('StorefrontWebhooksSection - providers', () => {
  afterEach(() => {
    // mockReset, not clearAllMocks: a queued mockResolvedValueOnce a test
    // never consumed must not leak into the next one.
    createWebhookAction.mockReset();
    setSecretAction.mockReset();
  });

  it('offers Connect Stripe and Connect Lemon Squeezy when neither is connected', () => {
    renderWithMantine(<StorefrontWebhooksSection initialWebhooks={[]} apiBaseUrl="" />);
    expect(screen.getByRole('button', { name: 'Connect Stripe' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect Lemon Squeezy' })).toBeInTheDocument();
  });

  it('hides the Connect button for a provider that is already connected, and names it properly', () => {
    renderWithMantine(
      <StorefrontWebhooksSection initialWebhooks={[pendingWebhook('lemonsqueezy')]} apiBaseUrl="" />
    );
    expect(screen.queryByRole('button', { name: 'Connect Lemon Squeezy' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect Stripe' })).toBeInTheDocument();
    expect(screen.getByText('Lemon Squeezy')).toBeInTheDocument();
  });

  it("shows a server's 'needs 1.7.0' rejection when connecting Lemon Squeezy", async () => {
    createWebhookAction.mockResolvedValueOnce({
      ok: false,
      reason: 'validation',
      message: 'Connecting Lemon Squeezy needs License Server 1.7.0 or later - ask whoever runs your license server to upgrade it.',
    });
    renderWithMantine(<StorefrontWebhooksSection initialWebhooks={[]} apiBaseUrl="" />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect Lemon Squeezy' }));

    await waitFor(() => expect(createWebhookAction).toHaveBeenCalledWith('lemonsqueezy'));
    expect(await screen.findByText(/needs License Server 1\.7\.0 or later/)).toBeInTheDocument();
  });

  it('Lemon Squeezy setup: Generate fills a 32-character secret, which is what gets saved', async () => {
    setSecretAction.mockResolvedValueOnce({ ok: true, data: true });
    const input = await openLemonSqueezySetup();
    expect(screen.getByText('order_created')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    const generated = (input as HTMLInputElement).value;
    expect(generated).toMatch(/^[0-9a-f]{32}$/);

    fireEvent.click(screen.getByRole('button', { name: 'Save secret' }));
    await waitFor(() => expect(setSecretAction).toHaveBeenCalledWith('wh_lemonsqueezy', generated));
  });

  it('Lemon Squeezy setup: a secret under 16 characters is caught before the round trip', async () => {
    const input = await openLemonSqueezySetup();
    fireEvent.change(input, { target: { value: 'tooshort' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save secret' }));

    expect(await screen.findByText('The signing secret must be 16-40 characters')).toBeInTheDocument();
    expect(setSecretAction).not.toHaveBeenCalled();
  });

  it("Lemon Squeezy setup: the server's own validation message is shown inline", async () => {
    setSecretAction.mockResolvedValueOnce({ ok: false, reason: 'validation', message: 'Server says no' });
    const input = await openLemonSqueezySetup();
    fireEvent.change(input, { target: { value: 'a'.repeat(20) } });
    fireEvent.click(screen.getByRole('button', { name: 'Save secret' }));

    expect(await screen.findByText('Server says no')).toBeInTheDocument();
  });

  it('Stripe setup is unchanged: no Generate button, Stripe events listed', async () => {
    renderWithMantine(<StorefrontWebhooksSection initialWebhooks={[pendingWebhook('stripe')]} apiBaseUrl="" />);
    fireEvent.click(screen.getByRole('button', { name: /Stripe/ }));
    await screen.findByLabelText(/Signing secret/);

    expect(screen.queryByRole('button', { name: 'Generate' })).not.toBeInTheDocument();
    expect(screen.getByText('checkout.session.completed')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('whsec_...')).toBeInTheDocument();
  });
});

describe('StorefrontWebhooksSection - refunds (License Server 1.8.0+)', () => {
  afterEach(() => {
    setRefundPolicyAction.mockReset();
  });

  function activeWebhook(provider: StorefrontWebhook['provider'], refund_policy?: 'revoke' | 'record'): StorefrontWebhook {
    return { ...pendingWebhook(provider), status: 'active', ...(refund_policy ? { refund_policy } : {}) };
  }

  async function open(webhook: StorefrontWebhook) {
    renderWithMantine(<StorefrontWebhooksSection initialWebhooks={[webhook]} apiBaseUrl="" />);
    // Anchored: the other provider's "Connect ..." button also names it.
    const label = webhook.provider === 'stripe' ? 'Stripe' : 'Lemon Squeezy';
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}`) }));
    await screen.findByRole('button', { name: 'Disable this webhook' });
  }

  it('shows the refund setting when the server reports a policy, naming the refund event', async () => {
    await open(activeWebhook('stripe', 'revoke'));
    expect(screen.getByText('When a purchase is fully refunded')).toBeInTheDocument();
    expect(screen.getByText('charge.refunded')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Revoke the license' })).toBeChecked();
  });

  it('the setting is a labelled group, for assistive technology', async () => {
    await open(activeWebhook('stripe', 'revoke'));
    expect(screen.getByRole('group', { name: 'When a purchase is fully refunded' })).toBeInTheDocument();
  });

  it('flags a record-only webhook on its collapsed row, and only that one', () => {
    renderWithMantine(
      <StorefrontWebhooksSection
        initialWebhooks={[activeWebhook('stripe', 'record'), activeWebhook('lemonsqueezy', 'revoke')]}
        apiBaseUrl=""
      />
    );
    expect(screen.getAllByText('Refunds: record only')).toHaveLength(1);
  });

  it('hides the refund setting against a server older than 1.8.0 (no refund_policy reported)', async () => {
    await open(activeWebhook('stripe'));
    expect(screen.queryByText('When a purchase is fully refunded')).not.toBeInTheDocument();
  });

  it("hides the refund setting on a disabled webhook (the server refuses changing it)", async () => {
    renderWithMantine(
      <StorefrontWebhooksSection initialWebhooks={[{ ...activeWebhook('stripe', 'record'), status: 'disabled' }]} apiBaseUrl="" />
    );
    fireEvent.click(screen.getByRole('button', { name: /^Stripe/ }));
    // The panel's history sections still render for a disabled webhook.
    await screen.findByText(/v1\/webhooks\/storefront\/wh_stripe/);

    expect(screen.queryByText('When a purchase is fully refunded')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Revoke the license' })).not.toBeInTheDocument();
    expect(setRefundPolicyAction).not.toHaveBeenCalled();
  });

  it('switching to record only saves it', async () => {
    setRefundPolicyAction.mockResolvedValueOnce({ ok: true, data: true });
    await open(activeWebhook('lemonsqueezy', 'revoke'));

    fireEvent.click(screen.getByRole('radio', { name: 'Keep it (record only)' }));

    await waitFor(() => expect(setRefundPolicyAction).toHaveBeenCalledWith('wh_lemonsqueezy', 'record'));
    // The save finished (the control re-enables) and the choice stuck.
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Revoke the license' })).toBeEnabled());
    expect(screen.getByRole('radio', { name: 'Keep it (record only)' })).toBeChecked();
    expect(screen.getByText('Refunds: record only')).toBeInTheDocument();
  });

  it('reverts the setting if saving fails', async () => {
    setRefundPolicyAction.mockResolvedValueOnce({ ok: false, reason: 'validation', message: 'nope' });
    await open(activeWebhook('stripe', 'revoke'));

    fireEvent.click(screen.getByRole('radio', { name: 'Keep it (record only)' }));

    await waitFor(() => expect(screen.getByRole('radio', { name: 'Revoke the license' })).toBeChecked());
  });

  it('setup steps name the refund event only when the server handles refunds', async () => {
    renderWithMantine(
      <StorefrontWebhooksSection initialWebhooks={[{ ...pendingWebhook('lemonsqueezy'), refund_policy: 'revoke' }]} apiBaseUrl="" />
    );
    fireEvent.click(screen.getByRole('button', { name: /Lemon Squeezy/ }));
    await screen.findByRole('button', { name: 'Save secret' });
    expect(screen.getByText('order_refunded')).toBeInTheDocument();
  });

  it("setup steps don't mention the refund event against an older server", async () => {
    renderWithMantine(<StorefrontWebhooksSection initialWebhooks={[pendingWebhook('stripe')]} apiBaseUrl="" />);
    fireEvent.click(screen.getByRole('button', { name: /Stripe/ }));
    await screen.findByRole('button', { name: 'Save secret' });
    expect(screen.queryByText('charge.refunded')).not.toBeInTheDocument();
  });
});
