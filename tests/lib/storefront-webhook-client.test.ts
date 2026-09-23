import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createStorefrontMapping,
  createStorefrontWebhook,
  deleteStorefrontMapping,
  disableStorefrontWebhook,
  listStorefrontDeliveries,
  listStorefrontMappings,
  listStorefrontWebhooks,
  setStorefrontWebhookSecret,
} from '@/lib/license-client.live';
import { LicenseApiError } from '@/lib/errors';

// STOREFRONT_WEBHOOK_PLAN.md - the live-client counterparts of
// casazium/license's admin-storefront-webhooks.js. Mirrors
// license-client-errors.test.ts's own mocked-fetch pattern.
describe('storefront webhook live client (lib/license-client.live.ts)', () => {
  beforeEach(() => {
    vi.stubEnv('LICENSE_API_URL', 'https://license.example.com/v1');
    vi.stubEnv('LICENSE_ADMIN_API_KEY', 'test-admin-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('listStorefrontWebhooks returns the parsed array', async () => {
    const webhooks = [{ id: 'wh_1', provider: 'stripe', status: 'active', created_at: 'x', last_event_at: null }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(webhooks), { status: 200 })));
    await expect(listStorefrontWebhooks('tenant-key')).resolves.toEqual(webhooks);
  });

  it('createStorefrontWebhook preserves the 409 "already exists" body text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'An active stripe storefront webhook already exists' }), {
          status: 409,
          statusText: 'Conflict',
        })
      )
    );
    await expect(createStorefrontWebhook('stripe', 'tenant-key')).rejects.toMatchObject({
      message: 'An active stripe storefront webhook already exists',
      status: 409,
    });
    await expect(createStorefrontWebhook('stripe', 'tenant-key')).rejects.toBeInstanceOf(LicenseApiError);
  });

  it('setStorefrontWebhookSecret returns false on a 404 (webhook not found/not owned), not an exception', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await expect(setStorefrontWebhookSecret('wh_missing', 'whsec_x', 'tenant-key')).resolves.toBe(false);
  });

  it('setStorefrontWebhookSecret returns true on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ updated: true }), { status: 200 }))
    );
    await expect(setStorefrontWebhookSecret('wh_1', 'whsec_x', 'tenant-key')).resolves.toBe(true);
  });

  it('disableStorefrontWebhook returns false on a 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await expect(disableStorefrontWebhook('wh_missing', 'tenant-key')).resolves.toBe(false);
  });

  it('disableStorefrontWebhook sends a non-empty body on its DELETE request', async () => {
    // Real bug, not hypothetical: liveFetch always sets Content-Type:
    // application/json, and Fastify's default JSON body parser 400s on
    // an empty body whenever that header is present - confirmed live
    // against a real license API before this test existed (a real
    // DELETE with no body here surfaced to a tenant as "Failed to
    // disable webhook, something went wrong"). A mocked fetch returning
    // a canned response, as every other test in this file does, can't
    // catch a malformed *request* - this test asserts on the call
    // itself, not just the mocked response, which is what actually
    // would have caught this before it shipped.
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ disabled: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await disableStorefrontWebhook('wh_1', 'tenant-key');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ method: 'DELETE', body: expect.any(String) })
    );
    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).not.toBe('');
  });

  it('listStorefrontMappings returns [] on a 404 rather than throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await expect(listStorefrontMappings('wh_missing', 'tenant-key')).resolves.toEqual([]);
  });

  describe('createStorefrontMapping', () => {
    const input = { ref_kind: 'payment_link' as const, external_ref: 'plink_1', product_id: 'widget', tier: 'pro' };

    it('rejects malformed limits JSON before ever calling fetch', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      await expect(
        createStorefrontMapping('wh_1', { ...input, limitsJson: '{not valid json' }, 'tenant-key')
      ).rejects.toThrow('Limits must be valid JSON');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('preserves the 400 body from validateLicenseLimits.js', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ error: 'Unknown limit key: bogus_key' }), { status: 400, statusText: 'Bad Request' })
        )
      );
      await expect(createStorefrontMapping('wh_1', input, 'tenant-key')).rejects.toMatchObject({
        message: 'Unknown limit key: bogus_key',
        status: 400,
      });
    });

    it('preserves the 409 "mapping already exists" body', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ error: 'A mapping for this reference already exists' }), {
            status: 409,
            statusText: 'Conflict',
          })
        )
      );
      await expect(createStorefrontMapping('wh_1', input, 'tenant-key')).rejects.toMatchObject({
        message: 'A mapping for this reference already exists',
        status: 409,
      });
    });

    it('succeeds and returns the new mapping id', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'map_1' }), { status: 200 })));
      await expect(createStorefrontMapping('wh_1', input, 'tenant-key')).resolves.toEqual({ id: 'map_1' });
    });
  });

  it('deleteStorefrontMapping returns false on a 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await expect(deleteStorefrontMapping('wh_1', 'map_missing', 'tenant-key')).resolves.toBe(false);
  });

  it('deleteStorefrontMapping sends a non-empty body on its DELETE request', async () => {
    // Same real bug/fix as disableStorefrontWebhook's own test above.
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ deleted: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await deleteStorefrontMapping('wh_1', 'map_1', 'tenant-key');
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('DELETE');
    expect(init.body).not.toBe('');
  });

  describe('listStorefrontDeliveries', () => {
    it('derives hasMore=true when a full page comes back', async () => {
      const rows = Array.from({ length: 20 }, (_, i) => ({
        tenant_id: 't',
        checkout_session_id: `cs_${i}`,
        outcome: 'issued' as const,
        attempts: 1,
        license_key: 'KEY',
        delivery_status: 'sent' as const,
        processed_at: '2026-01-01T00:00:00Z',
      }));
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(rows), { status: 200 })));
      const result = await listStorefrontDeliveries('wh_1', { limit: 20, offset: 0 }, 'tenant-key');
      expect(result.deliveries).toHaveLength(20);
      expect(result.hasMore).toBe(true);
    });

    it('derives hasMore=false when a partial page comes back', async () => {
      const rows = [
        {
          tenant_id: 't',
          checkout_session_id: 'cs_1',
          outcome: 'issued' as const,
          attempts: 1,
          license_key: 'KEY',
          delivery_status: 'sent' as const,
          processed_at: '2026-01-01T00:00:00Z',
        },
      ];
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(rows), { status: 200 })));
      const result = await listStorefrontDeliveries('wh_1', { limit: 20, offset: 0 }, 'tenant-key');
      expect(result.hasMore).toBe(false);
    });

    it('returns an empty, non-hasMore result on a 404 rather than throwing', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
      await expect(listStorefrontDeliveries('wh_missing', {}, 'tenant-key')).resolves.toEqual({
        deliveries: [],
        hasMore: false,
      });
    });
  });
});
