// @vitest-environment jsdom
// Paddle in the storefront webhooks section (PADDLE_FULFILLMENT_DESIGN.md
// §10, License Server 1.11.0+): the environment chosen at connect, the
// secret and API key both needed before the webhook goes live, a key
// problem explained, and "Send pending deliveries".
import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StorefrontWebhooksSection } from '@/app/(app)/settings/StorefrontWebhooksSection';
import type { StorefrontWebhook } from '@/lib/license-client';

const createWebhookAction = vi.fn();
const setSecretAction = vi.fn();
const setApiKeyAction = vi.fn();
const sendPendingAction = vi.fn();
const listDeliveriesAction = vi.fn().mockResolvedValue({ ok: true, data: { deliveries: [], hasMore: false } });
const notifyShow = vi.fn();

vi.mock('@mantine/notifications', () => ({ notifications: { show: (...args: unknown[]) => notifyShow(...args) } }));
vi.mock('@/lib/notify', () => ({ notifyRateLimited: vi.fn() }));

vi.mock('@/app/(app)/settings/actions', () => ({
  createStorefrontWebhookAction: (...args: unknown[]) => createWebhookAction(...args),
  setStorefrontWebhookSecretAction: (...args: unknown[]) => setSecretAction(...args),
  setStorefrontWebhookApiKeyAction: (...args: unknown[]) => setApiKeyAction(...args),
  sendStorefrontPendingDeliveriesAction: (...args: unknown[]) => sendPendingAction(...args),
  setStorefrontRefundPolicyAction: vi.fn(),
  setStorefrontSubscriptionGraceAction: vi.fn(),
  disableStorefrontWebhookAction: vi.fn(),
  listStorefrontMappingsAction: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  createStorefrontMappingAction: vi.fn(),
  deleteStorefrontMappingAction: vi.fn(),
  listStorefrontDeliveriesAction: (...args: unknown[]) => listDeliveriesAction(...args),
}));

const SECRET = 'pdl_ntfset_01m4xa0000000000000000000000_' + 's'.repeat(32);
const key = (env: string) => `pdl_${env}_apikey_01m4xapsjdq2ac7r5ke66my10d_${'K'.repeat(22)}_abc`;

function renderWithMantine(ui: ReactElement) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

function paddleWebhook(overrides: Partial<StorefrontWebhook> = {}): StorefrontWebhook {
  return {
    id: 'wh_paddle',
    provider: 'paddle',
    status: 'pending',
    created_at: '2026-10-14T00:00:00Z',
    last_event_at: null,
    environment: 'sandbox',
    has_api_key: false,
    api_key_problem: null,
    ...overrides,
  };
}

async function openPaddle(webhook: StorefrontWebhook) {
  renderWithMantine(<StorefrontWebhooksSection initialWebhooks={[webhook]} apiBaseUrl="https://l.example.test/v1" />);
  fireEvent.click(screen.getByRole('button', { name: /^Paddle/ }));
  // Wait until the opening accordion panel is accessible, not just rendered.
  await screen.findByRole('button', { name: 'Save API key' });
}

afterEach(() => {
  createWebhookAction.mockReset();
  setSecretAction.mockReset();
  setApiKeyAction.mockReset();
  sendPendingAction.mockReset();
  notifyShow.mockReset();
  listDeliveriesAction.mockClear();
});

describe('connecting Paddle', () => {
  it('asks for the environment first, and connects with the one chosen', async () => {
    createWebhookAction.mockResolvedValueOnce({ ok: true, data: paddleWebhook({ environment: 'live' }) });
    renderWithMantine(<StorefrontWebhooksSection initialWebhooks={[]} apiBaseUrl="" />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect Paddle' }));
    expect(createWebhookAction).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole('radio', { name: 'Live' }));
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(createWebhookAction).toHaveBeenCalledWith('paddle', 'live'));
    expect(await screen.findByText('Live')).toBeInTheDocument();
  });

  it('defaults to sandbox', async () => {
    createWebhookAction.mockResolvedValueOnce({ ok: true, data: paddleWebhook() });
    renderWithMantine(<StorefrontWebhooksSection initialWebhooks={[]} apiBaseUrl="" />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect Paddle' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(createWebhookAction).toHaveBeenCalledWith('paddle', 'sandbox'));
  });
});

describe('Paddle setup: the secret and the API key', () => {
  it('shows the Paddle steps, with both fields', async () => {
    await openPaddle(paddleWebhook());
    expect(await screen.findByText('transaction.completed')).toBeInTheDocument();
    expect(screen.getByText(/Customers: read and a custom expiry/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Signing secret/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^API key/)).toBeInTheDocument();
  });

  it('refuses a secret without the pdl_ntfset_ prefix before the round trip', async () => {
    await openPaddle(paddleWebhook());
    fireEvent.change(await screen.findByLabelText(/Signing secret/), { target: { value: 'whsec_' + 'a'.repeat(64) } });
    fireEvent.click(screen.getByRole('button', { name: 'Save secret' }));
    expect(await screen.findByText(/starts with pdl_ntfset_/)).toBeInTheDocument();
    expect(setSecretAction).not.toHaveBeenCalled();
  });

  it('a saved secret leaves the webhook needing setup until the key is saved, then it goes active', async () => {
    setSecretAction.mockResolvedValueOnce({ ok: true, data: 'pending' });
    setApiKeyAction.mockResolvedValueOnce({ ok: true, data: 'active' });
    await openPaddle(paddleWebhook());

    fireEvent.change(await screen.findByLabelText(/Signing secret/), { target: { value: SECRET } });
    fireEvent.click(screen.getByRole('button', { name: 'Save secret' }));
    await waitFor(() => expect(setSecretAction).toHaveBeenCalledWith('wh_paddle', SECRET));
    expect(await screen.findByLabelText(/Signing secret \(saved/)).toBeInTheDocument();
    expect(screen.getByText('Needs setup')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^API key/), { target: { value: key('sdbx') } });
    fireEvent.click(screen.getByRole('button', { name: 'Save API key' }));
    await waitFor(() => expect(setApiKeyAction).toHaveBeenCalledWith('wh_paddle', key('sdbx')));
    expect(await screen.findByText('Active')).toBeInTheDocument();
  });

  it("refuses a key from the other environment, or one that isn't a Paddle key, before the round trip", async () => {
    await openPaddle(paddleWebhook());
    const input = await screen.findByLabelText(/^API key/);
    fireEvent.change(input, { target: { value: key('live') } });
    fireEvent.click(screen.getByRole('button', { name: 'Save API key' }));
    expect(await screen.findByText(/That is a live key/)).toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'a'.repeat(50) } });
    fireEvent.click(screen.getByRole('button', { name: 'Save API key' }));
    expect(await screen.findByText(/Paste a Paddle API key/)).toBeInTheDocument();
    expect(setApiKeyAction).not.toHaveBeenCalled();
  });

  it("shows the server's refusal of a key (Paddle said no) under the field", async () => {
    setApiKeyAction.mockResolvedValueOnce({
      ok: false,
      reason: 'validation',
      message: 'Paddle refused this key: it needs the Customers: read permission in sandbox',
    });
    await openPaddle(paddleWebhook());
    fireEvent.change(await screen.findByLabelText(/^API key/), { target: { value: key('sdbx') } });
    fireEvent.click(screen.getByRole('button', { name: 'Save API key' }));
    expect(await screen.findByText(/Paddle refused this key/)).toBeInTheDocument();
  });
});

describe('an active Paddle webhook', () => {
  it('flags a key problem on the row and explains it in the panel', async () => {
    await openPaddle(paddleWebhook({ status: 'active', has_api_key: true, api_key_problem: 'key_revoked' }));
    expect(screen.getByText('API key')).toBeInTheDocument();
    expect(await screen.findByText('The API key was revoked in Paddle')).toBeInTheDocument();
    expect(screen.getByLabelText(/Replace the API key/)).toBeInTheDocument();
  });

  it('a new key clears the problem', async () => {
    setApiKeyAction.mockResolvedValueOnce({ ok: true, data: 'active' });
    await openPaddle(paddleWebhook({ status: 'active', has_api_key: true, api_key_problem: 'key_revoked' }));
    fireEvent.change(await screen.findByLabelText(/Replace the API key/), { target: { value: key('sdbx') } });
    fireEvent.click(screen.getByRole('button', { name: 'Save API key' }));
    await waitFor(() => expect(screen.queryByText('The API key was revoked in Paddle')).not.toBeInTheDocument());
  });

  it('sends pending deliveries, says what happened, and reloads the deliveries', async () => {
    sendPendingAction.mockResolvedValueOnce({
      ok: true,
      data: { sent: 3, skipped: 0, not_found: 1, failed: 0, remaining: 2, stopped: 'time_budget' },
    });
    await openPaddle(paddleWebhook({ status: 'active', has_api_key: true }));
    await waitFor(() => expect(listDeliveriesAction).toHaveBeenCalledTimes(1));

    fireEvent.click(await screen.findByRole('button', { name: 'Send pending deliveries' }));
    await waitFor(() => expect(sendPendingAction).toHaveBeenCalledWith('wh_paddle'));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Sent 3. 1 not found in Paddle. 2 still waiting. There are more to send - run it again.'
    );
    await waitFor(() => expect(listDeliveriesAction).toHaveBeenCalledTimes(2));
  });

  it('says the webhook changed when a run stops for that (License Server 1.11.1+)', async () => {
    sendPendingAction.mockResolvedValueOnce({
      ok: true,
      data: { sent: 1, skipped: 0, not_found: 0, failed: 0, remaining: 4, stopped: 'webhook_changed' },
    });
    await openPaddle(paddleWebhook({ status: 'active', has_api_key: true }));
    fireEvent.click(await screen.findByRole('button', { name: 'Send pending deliveries' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Sent 1. 4 still waiting. The webhook was disconnected or given a new API key while sending - check it, then run it again.'
    );
  });

  it("shows a server refusal (a run already going) as a notification", async () => {
    sendPendingAction.mockResolvedValueOnce({
      ok: false,
      reason: 'validation',
      message: 'Already sending pending deliveries for this account - wait for it to finish',
    });
    await openPaddle(paddleWebhook({ status: 'active', has_api_key: true }));
    fireEvent.click(await screen.findByRole('button', { name: 'Send pending deliveries' }));
    await waitFor(() =>
      expect(notifyShow).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('Already sending') }))
    );
  });

  it('shows the environment on the row', async () => {
    renderWithMantine(
      <StorefrontWebhooksSection initialWebhooks={[paddleWebhook({ status: 'active', has_api_key: true })]} apiBaseUrl="" />
    );
    expect(screen.getByText('Sandbox')).toBeInTheDocument();
  });
});

describe('a provider this console does not know', () => {
  it('shows a notice on its row instead of breaking the page', async () => {
    const unknown = { ...paddleWebhook({ status: 'active' }), id: 'wh_future', provider: 'gumroad' } as unknown as StorefrontWebhook;
    renderWithMantine(<StorefrontWebhooksSection initialWebhooks={[unknown]} apiBaseUrl="" />);
    fireEvent.click(screen.getByRole('button', { name: /gumroad/ }));
    expect(await screen.findByText('Not supported by this console')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect Stripe' })).toBeInTheDocument();
  });
});
