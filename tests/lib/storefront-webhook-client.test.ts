import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createStorefrontMapping,
  createStorefrontWebhook,
  deleteStorefrontMapping,
  disableStorefrontWebhook,
  listStorefrontDeliveries,
  listStorefrontMappings,
  listStorefrontWebhooks,
  setStorefrontRefundPolicy,
  setStorefrontSubscriptionGrace,
  sendStorefrontPendingDeliveries,
  setStorefrontWebhookApiKey,
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

  it('createStorefrontWebhook explains a Lemon Squeezy rejection from a License Server older than 1.7.0', async () => {
    // What a pre-1.7.0 server's schema validation actually returns.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'body/provider must be equal to one of the allowed values' }), {
          status: 400,
          statusText: 'Bad Request',
        })
      )
    );
    await expect(createStorefrontWebhook('lemonsqueezy', 'tenant-key')).rejects.toMatchObject({
      message: expect.stringContaining('Connecting Lemon Squeezy needs License Server 1.7.0 or later'),
      status: 400,
    });
  });

  it("createStorefrontWebhook keeps the server's own 400 text for Stripe", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'some validation error' }), { status: 400 }))
    );
    await expect(createStorefrontWebhook('stripe', 'tenant-key')).rejects.toMatchObject({
      message: 'some validation error',
      status: 400,
    });
  });

  it("setStorefrontWebhookSecret preserves the server's 400 text (Lemon Squeezy secret length)", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'A lemonsqueezy signing secret must be 16-40 characters' }), {
          status: 400,
        })
      )
    );
    await expect(setStorefrontWebhookSecret('wh_1', 'short', 'tenant-key')).rejects.toMatchObject({
      message: 'A lemonsqueezy signing secret must be 16-40 characters',
      status: 400,
    });
  });

  describe('setStorefrontRefundPolicy', () => {
    it('PATCHes the webhook with the policy and returns true', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ id: 'wh_1', refund_policy: 'record' }), { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);

      await expect(setStorefrontRefundPolicy('wh_1', 'record', 'tenant-key')).resolves.toBe(true);
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toContain('/admin/storefront-webhooks/wh_1');
      expect(init.method).toBe('PATCH');
      expect(JSON.parse(init.body)).toEqual({ refund_policy: 'record' });
    });

    it('returns false when the webhook itself is not found', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Storefront webhook not found' }), { status: 404 }))
      );
      await expect(setStorefrontRefundPolicy('wh_missing', 'record', 'tenant-key')).resolves.toBe(false);
    });

    it("explains a License Server older than 1.8.0, which has no PATCH route (Fastify's own 404)", async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({ message: 'Route PATCH:/v1/admin/storefront-webhooks/wh_1 not found', error: 'Not Found', statusCode: 404 }),
            { status: 404 }
          )
        )
      );
      await expect(setStorefrontRefundPolicy('wh_1', 'record', 'tenant-key')).rejects.toMatchObject({
        message: 'Refund handling needs License Server 1.8.0 or later.',
      });
    });
  });

  it('setStorefrontWebhookSecret returns null on a 404 (webhook not found/not owned), not an exception', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await expect(setStorefrontWebhookSecret('wh_missing', 'whsec_x', 'tenant-key')).resolves.toBeNull();
  });

  it("setStorefrontWebhookSecret returns the server's status, and 'active' from a server that doesn't say", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ updated: true, status: 'pending' }), { status: 200 }))
    );
    await expect(setStorefrontWebhookSecret('wh_1', 'pdl_ntfset_x', 'tenant-key')).resolves.toBe('pending');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ updated: true }), { status: 200 }))
    );
    await expect(setStorefrontWebhookSecret('wh_1', 'whsec_x', 'tenant-key')).resolves.toBe('active');
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

  describe('setStorefrontSubscriptionGrace (License Server 1.9.0+)', () => {
    it('PATCHes the webhook with only the grace and returns true', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ id: 'wh_1', refund_policy: 'revoke', subscription_grace_days: 14 }), { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);

      await expect(setStorefrontSubscriptionGrace('wh_1', 14, 'tenant-key')).resolves.toBe(true);
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toContain('/admin/storefront-webhooks/wh_1');
      expect(init.method).toBe('PATCH');
      expect(JSON.parse(init.body)).toEqual({ subscription_grace_days: 14 });
    });

    it('returns false when the webhook itself is not found', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Storefront webhook not found' }), { status: 404 }))
      );
      await expect(setStorefrontSubscriptionGrace('wh_missing', 7, 'tenant-key')).resolves.toBe(false);
    });

    it("explains a server with no PATCH route (Fastify's own 404)", async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({ message: 'Route PATCH:/v1/admin/storefront-webhooks/wh_1 not found', error: 'Not Found', statusCode: 404 }),
            { status: 404 }
          )
        )
      );
      await expect(setStorefrontSubscriptionGrace('wh_1', 7, 'tenant-key')).rejects.toThrow('Subscriptions need License Server 1.9.0 or later.');
    });

    it("passes the server's 400 message through", async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ error: 'subscription_grace_days must be a whole number of days, 0-30' }), { status: 400 })
        )
      );
      await expect(setStorefrontSubscriptionGrace('wh_1', 7, 'tenant-key')).rejects.toThrow(/0-30/);
    });
  });
});

// PADDLE_FULFILLMENT_DESIGN.md §8 (License Server 1.11.0+).
describe('Paddle webhook live client', () => {
  beforeEach(() => {
    vi.stubEnv('LICENSE_API_URL', 'https://license.example.com/v1');
    vi.stubEnv('LICENSE_ADMIN_API_KEY', 'test-admin-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

  it('createStorefrontWebhook sends the environment for Paddle, and none otherwise', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => json(200, { id: 'wh_1', provider: 'paddle', status: 'pending' }));
    vi.stubGlobal('fetch', fetchMock);
    await createStorefrontWebhook('paddle', 'tenant-key', 'live');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ provider: 'paddle', environment: 'live' });
    await createStorefrontWebhook('stripe', 'tenant-key');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ provider: 'stripe' });
  });

  it("a server too old for Paddle says which version it needs", async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => json(400, { message: 'body/provider must be equal to one of the allowed values' })));
    await expect(createStorefrontWebhook('paddle', 'tenant-key', 'sandbox')).rejects.toThrow(/License Server 1\.11\.0/);
  });

  it("setStorefrontWebhookApiKey posts the key and returns the server's status", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => json(200, { updated: true, status: 'active' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(setStorefrontWebhookApiKey('wh_1', 'pdl_sdbx_apikey_x', 'tenant-key')).resolves.toBe('active');
    expect(fetchMock.mock.calls[0][0]).toBe('https://license.example.com/v1/admin/storefront-webhooks/wh_1/api-key');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ api_key: 'pdl_sdbx_apikey_x' });
  });

  it.each([
    [400, 'Paddle refused this key: it needs the Customers: read permission in sandbox'],
    [502, "Couldn't reach Paddle to check the key - try again"],
    [503, 'Paddle is rate limiting this server - try again in a minute'],
  ])("setStorefrontWebhookApiKey keeps the server's %s message", async (status, error) => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => json(status, { error })));
    const call = setStorefrontWebhookApiKey('wh_1', 'pdl_sdbx_apikey_x', 'tenant-key');
    await expect(call).rejects.toBeInstanceOf(LicenseApiError);
    await expect(setStorefrontWebhookApiKey('wh_1', 'pdl_sdbx_apikey_x', 'tenant-key')).rejects.toThrow(error);
  });

  it('setStorefrontWebhookApiKey: null for a missing webhook, a version message for a server without the route', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => json(404, { error: 'Storefront webhook not found' })));
    await expect(setStorefrontWebhookApiKey('wh_missing', 'k', 'tenant-key')).resolves.toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => json(404, { message: 'Route POST:/v1/admin/storefront-webhooks/wh_1/api-key not found' })));
    await expect(setStorefrontWebhookApiKey('wh_1', 'k', 'tenant-key')).rejects.toThrow(/License Server 1\.11\.0/);
  });

  it('sendStorefrontPendingDeliveries returns the run, sends a non-empty body, and keeps a 409 message', async () => {
    const run = { sent: 2, skipped: 0, not_found: 0, failed: 0, remaining: 0, stopped: null };
    const fetchMock = vi.fn().mockImplementation(async () => json(200, run));
    vi.stubGlobal('fetch', fetchMock);
    await expect(sendStorefrontPendingDeliveries('wh_1', 'tenant-key')).resolves.toEqual(run);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', body: '{}' });

    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => json(409, { error: 'Already sending pending deliveries for this account - wait for it to finish' })));
    await expect(sendStorefrontPendingDeliveries('wh_1', 'tenant-key')).rejects.toThrow(/Already sending/);
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => json(404, { error: 'Storefront webhook not found' })));
    await expect(sendStorefrontPendingDeliveries('wh_missing', 'tenant-key')).resolves.toBeNull();
  });
});
