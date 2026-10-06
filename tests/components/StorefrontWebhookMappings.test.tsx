// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StorefrontWebhookMappings } from '@/app/(app)/settings/StorefrontWebhookMappings';

// Real bug found live (not by this suite - by an actual browser smoke
// test) while verifying STOREFRONT_WEBHOOK_PLAN.md's console section:
// every text-field onChange in the "Add mapping" form read
// `e.currentTarget.value` *inside* the setForm functional updater
// (`setForm((f) => ({ ...f, external_ref: e.currentTarget.value }))`)
// instead of capturing it synchronously first. React nulls out a
// SyntheticEvent's fields once the handler that received it returns, so
// by the time the updater callback actually ran, `e.currentTarget` was
// already `null` - "Cannot read properties of null (reading 'value')",
// crashing the whole Settings page into its error boundary the instant
// a tenant typed a single character into any of these fields. Every
// field below was fixed the same way (capture the value first, then
// reference that captured primitive inside the updater) - this test
// exercises all of them so a regression back to the lazy-read pattern
// fails loudly here instead of only in a real browser.
const listMappingsAction = vi.fn().mockResolvedValue({ ok: true, data: [] });
const createMappingAction = vi.fn().mockResolvedValue({ ok: true, data: { id: 'map_new' } });
const deleteMappingAction = vi.fn().mockResolvedValue({ ok: true, data: true });

vi.mock('@/app/(app)/settings/actions', () => ({
  listStorefrontMappingsAction: (...args: unknown[]) => listMappingsAction(...args),
  createStorefrontMappingAction: (...args: unknown[]) => createMappingAction(...args),
  deleteStorefrontMappingAction: (...args: unknown[]) => deleteMappingAction(...args),
}));

function renderWithMantine(ui: ReactElement) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

describe('StorefrontWebhookMappings - "Add mapping" form typing (regression, currentTarget-null crash)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  async function openForm() {
    renderWithMantine(<StorefrontWebhookMappings webhookId="wh_1" provider="stripe" active={true} />);
    await waitFor(() => expect(listMappingsAction).toHaveBeenCalledWith('wh_1'));
    fireEvent.click(await screen.findByRole('button', { name: 'Add mapping' }));
  }

  it('typing into the reference field does not throw and reflects the typed value', async () => {
    await openForm();
    const refInput = screen.getByPlaceholderText('plink_...');
    expect(() => fireEvent.change(refInput, { target: { value: 'plink_abc123' } })).not.toThrow();
    expect(refInput).toHaveValue('plink_abc123');
  });

  it('typing into Product ID does not throw and reflects the typed value', async () => {
    await openForm();
    const input = screen.getByLabelText('Product ID');
    expect(() => fireEvent.change(input, { target: { value: 'widget-pro' } })).not.toThrow();
    expect(input).toHaveValue('widget-pro');
  });

  it('typing into Tier does not throw and reflects the typed value', async () => {
    await openForm();
    const input = screen.getByLabelText('Tier');
    expect(() => fireEvent.change(input, { target: { value: 'pro' } })).not.toThrow();
    expect(input).toHaveValue('pro');
  });

  it('typing into Limits (JSON) does not throw and reflects the typed value', async () => {
    await openForm();
    const input = screen.getByLabelText('Limits (optional, JSON)');
    expect(() => fireEvent.change(input, { target: { value: '{"seats": 5}' } })).not.toThrow();
    expect(input).toHaveValue('{"seats": 5}');
  });

  it('typing into Notes does not throw and reflects the typed value', async () => {
    await openForm();
    const input = screen.getByLabelText('Notes (optional)');
    expect(() => fireEvent.change(input, { target: { value: 'a note' } })).not.toThrow();
    expect(input).toHaveValue('a note');
  });

  it('a full fill-and-submit round trip calls the Server Action with the typed values', async () => {
    await openForm();
    fireEvent.change(screen.getByPlaceholderText('plink_...'), { target: { value: 'plink_abc123' } });
    fireEvent.change(screen.getByLabelText('Product ID'), { target: { value: 'widget-pro' } });
    fireEvent.change(screen.getByLabelText('Tier'), { target: { value: 'pro' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add mapping' }));

    await waitFor(() =>
      expect(createMappingAction).toHaveBeenCalledWith(
        'wh_1',
        expect.objectContaining({ external_ref: 'plink_abc123', product_id: 'widget-pro', tier: 'pro' })
      )
    );
  });
});

describe('StorefrontWebhookMappings - per-provider reference types', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  async function openFormFor(provider: 'stripe' | 'lemonsqueezy') {
    renderWithMantine(<StorefrontWebhookMappings webhookId="wh_1" provider={provider} active={true} />);
    await waitFor(() => expect(listMappingsAction).toHaveBeenCalledWith('wh_1'));
    fireEvent.click(await screen.findByRole('button', { name: 'Add mapping' }));
  }

  it('a Lemon Squeezy webhook defaults to a Variant ID reference and submits ref_kind variant', async () => {
    await openFormFor('lemonsqueezy');
    expect(screen.getByLabelText('Variant ID')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('plink_...')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Variant ID'), { target: { value: '123456' } });
    fireEvent.change(screen.getByLabelText('Product ID'), { target: { value: 'widget-pro' } });
    fireEvent.change(screen.getByLabelText('Tier'), { target: { value: 'pro' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add mapping' }));

    await waitFor(() =>
      expect(createMappingAction).toHaveBeenCalledWith(
        'wh_1',
        expect.objectContaining({ ref_kind: 'variant', external_ref: '123456' })
      )
    );
  });

  it('a non-numeric Variant ID is caught before the round trip, in plain language', async () => {
    await openFormFor('lemonsqueezy');
    fireEvent.change(screen.getByLabelText('Variant ID'), { target: { value: 'Pro yearly' } });
    fireEvent.change(screen.getByLabelText('Product ID'), { target: { value: 'widget-pro' } });
    fireEvent.change(screen.getByLabelText('Tier'), { target: { value: 'pro' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add mapping' }));

    expect(await screen.findByText(/A Variant ID is a number/)).toBeInTheDocument();
    expect(createMappingAction).not.toHaveBeenCalled();
  });

  it('a Stripe webhook still defaults to a Payment Link reference', async () => {
    await openFormFor('stripe');
    expect(screen.getByLabelText('Payment Link ID')).toBeInTheDocument();
    expect(screen.queryByLabelText('Variant ID')).not.toBeInTheDocument();
  });

  it('existing mappings are labelled by their reference type', async () => {
    listMappingsAction.mockResolvedValueOnce({
      ok: true,
      data: [
        {
          id: 'map_1',
          webhook_id: 'wh_1',
          tenant_id: 't',
          provider: 'lemonsqueezy',
          ref_kind: 'variant',
          external_ref: '123456',
          product_id: 'widget-pro',
          tier: 'pro',
          limits_json: null,
          max_activations: null,
          duration_days: null,
          notes: null,
          created_at: '2026-10-05T00:00:00Z',
        },
      ],
    });
    renderWithMantine(<StorefrontWebhookMappings webhookId="wh_1" provider="lemonsqueezy" active={true} />);
    expect(await screen.findByText('123456')).toBeInTheDocument();
    expect(screen.getByText('Variant')).toBeInTheDocument();
  });
});
