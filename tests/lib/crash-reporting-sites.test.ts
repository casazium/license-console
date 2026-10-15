// PR B's sites (CRASH_REPORTING_DESIGN.md §6.1-§6.3, §8): what each reports,
// and what it shows the user. reportError is replaced by a spy; the
// reporter itself is tested in crash-reporter.test.ts and, in a built
// server, by scripts/crash-reporting-e2e.mjs.
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LicenseApiError } from '@/lib/errors';

const reportError = vi.fn();
vi.mock('@/lib/crash-reporter', () => ({ reportError: (...args: unknown[]) => reportError(...args) }));

const setApiKeyOnServer = vi.fn();
const createMappingOnServer = vi.fn();
vi.mock('@/lib/tenant-context', () => ({
  requireSessionWithTenantKey: vi.fn().mockResolvedValue({ identity: { tenantId: 't1' }, tenantApiKey: 'tenant-key' }),
  markIfTenantRejected: vi.fn(),
}));
vi.mock('@/lib/license-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/license-client')>()),
  setStorefrontWebhookApiKey: (...args: unknown[]) => setApiKeyOnServer(...args),
  createStorefrontMapping: (...args: unknown[]) => createMappingOnServer(...args),
}));

const { setStorefrontWebhookApiKeyAction, createStorefrontMappingAction } = await import('@/app/(app)/settings/actions');

afterEach(() => {
  reportError.mockReset();
  setApiKeyOnServer.mockReset();
  createMappingOnServer.mockReset();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('storefront actions (§6.3)', () => {
  const mapping = { ref_kind: 'price', external_ref: 'pri_1', tier: 'pro' } as never;

  it("shows a License Server refusal's message and reports nothing", async () => {
    createMappingOnServer.mockRejectedValueOnce(new LicenseApiError('A mapping for this reference already exists', 409));
    await expect(createStorefrontMappingAction('wh_1', mapping)).resolves.toEqual({
      ok: false,
      reason: 'validation',
      message: 'A mapping for this reference already exists',
    });
    expect(reportError).not.toHaveBeenCalled();
  });

  it("shows a tenant's malformed limits as a validation message and reports nothing", async () => {
    createMappingOnServer.mockRejectedValueOnce(new LicenseApiError('Limits must be valid JSON', 400));
    await expect(createStorefrontMappingAction('wh_1', mapping)).resolves.toMatchObject({
      message: 'Limits must be valid JSON',
    });
    expect(reportError).not.toHaveBeenCalled();
  });

  it("shows Paddle's relayed answer (display) and reports nothing", async () => {
    const err = new LicenseApiError("Couldn't reach Paddle to check the key - try again", 502);
    err.display = true;
    setApiKeyOnServer.mockRejectedValueOnce(err);
    await expect(setStorefrontWebhookApiKeyAction('wh_1', 'k')).resolves.toMatchObject({
      message: "Couldn't reach Paddle to check the key - try again",
    });
    expect(reportError).not.toHaveBeenCalled();
  });

  it('shows a proxy 502 but reports it: the License Server may be down', async () => {
    setApiKeyOnServer.mockRejectedValueOnce(new LicenseApiError('Failed to save the API key: 502 Bad Gateway', 502));
    await expect(setStorefrontWebhookApiKeyAction('wh_1', 'k')).resolves.toMatchObject({
      message: 'Failed to save the API key: 502 Bad Gateway',
    });
    expect(reportError).toHaveBeenCalledWith(expect.any(LicenseApiError), 'storefront webhook action failed', '/settings');
  });

  it('reports any other error as a fault, behind a generic message', async () => {
    createMappingOnServer.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(createStorefrontMappingAction('wh_1', mapping)).resolves.toEqual({
      ok: false,
      reason: 'validation',
      message: "Couldn't reach the License Server - try again",
    });
    expect(reportError).toHaveBeenCalledWith(expect.any(TypeError), 'storefront webhook action failed', '/settings');
  });

  it('classifies a LicenseApiError by name, whichever copy of the class threw it', async () => {
    const other = Object.assign(new Error('Already exists'), { name: 'LicenseApiError', status: 409 });
    createMappingOnServer.mockRejectedValueOnce(other);
    await expect(createStorefrontMappingAction('wh_1', mapping)).resolves.toMatchObject({ message: 'Already exists' });
    expect(reportError).not.toHaveBeenCalled();
  });
});

describe('the live client marks what it raises (§6.3)', () => {
  beforeEach(() => {
    vi.stubEnv('LICENSE_API_URL', 'https://license.example.com/v1');
    vi.stubEnv('LICENSE_ADMIN_API_KEY', 'test-admin-key');
  });

  it("marks Paddle's relayed 502/503 display, and a proxy's 502 not", async () => {
    const live = await vi.importActual<typeof import('@/lib/license-client.live')>('@/lib/license-client.live');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Couldn't reach Paddle to check the key - try again" }), { status: 502 })
      )
    );
    const relayed = await live.setStorefrontWebhookApiKey('wh_1', 'k', 'tenant-key').catch((e: unknown) => e);
    expect(relayed).toMatchObject({ name: 'LicenseApiError', status: 502, display: true });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('<html>Bad Gateway</html>', { status: 502 })));
    const proxied = await live.setStorefrontWebhookApiKey('wh_1', 'k', 'tenant-key').catch((e: unknown) => e);
    expect(proxied).toMatchObject({ name: 'LicenseApiError', status: 502 });
    expect((proxied as { display?: boolean }).display).toBeUndefined();
  });

  it('raises malformed limits as a LicenseApiError 400, before any request', async () => {
    const live = await vi.importActual<typeof import('@/lib/license-client.live')>('@/lib/license-client.live');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const err = await live
      .createStorefrontMapping('wh_1', { ref_kind: 'price', external_ref: 'pri_1', tier: 'pro', limitsJson: '{tier: 1}' } as never, 'tenant-key')
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ name: 'LicenseApiError', status: 400, message: 'Limits must be valid JSON' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

// The mock keeps its webhooks in memory across tests: reuse one.
async function lemonWebhook(m: typeof import('@/lib/license-client.mock')) {
  const existing = (await m.listStorefrontWebhooks()).find((w) => w.provider === 'lemonsqueezy' && w.status !== 'disabled');
  return existing ?? m.createStorefrontWebhook('lemonsqueezy');
}

describe('the mock client throws LicenseApiErrors for validation (§6.3)', () => {
  it.each([
    ['a second active webhook', 409, async (m: typeof import('@/lib/license-client.mock')) => {
      await m.createStorefrontWebhook('stripe');
      return m.createStorefrontWebhook('stripe');
    }],
    ['a paddle webhook with no environment', 400, (m: typeof import('@/lib/license-client.mock')) => m.createStorefrontWebhook('paddle')],
    ['a signing secret of the wrong length', 400, async (m: typeof import('@/lib/license-client.mock')) => {
      const wh = await lemonWebhook(m);
      return m.setStorefrontWebhookSecret(wh.id, 'short');
    }],
    ['an API key on a non-Paddle webhook', 400, async (m: typeof import('@/lib/license-client.mock')) => {
      const wh = await lemonWebhook(m);
      return m.setStorefrontWebhookApiKey(wh.id, 'pdl_sdbx_apikey_x');
    }],
  ])('%s: status %i', async (_name, status, run) => {
    vi.resetModules();
    const m = await vi.importActual<typeof import('@/lib/license-client.mock')>('@/lib/license-client.mock');
    const err = await run(m).catch((e: unknown) => e);
    expect(err).toMatchObject({ name: 'LicenseApiError', status });
  });

  it('a malformed limits string, with the status the live server would send', async () => {
    const mock = await import('@/lib/license-client.mock');
    const webhook = await lemonWebhook(mock);
    const err = await mock
      .createStorefrontMapping(webhook.id, { ref_kind: 'variant', external_ref: '123', tier: 'pro', limitsJson: '{tier: 1}' } as never)
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ name: 'LicenseApiError', status: 400, message: 'Limits must be valid JSON' });
  });
});

describe('verifySessionToken (§6.3)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('SESSION_SECRET', 'x'.repeat(48));
    vi.stubEnv('MULTI_TENANT', 'true');
  });

  it('a junk, expired or forged cookie reports nothing', async () => {
    const { verifySessionToken } = await import('@/lib/session');
    await expect(verifySessionToken('garbage')).resolves.toBeNull();
    await expect(verifySessionToken('eyJhbGciOiJIUzI1NiJ9.eyJpZCI6IngifQ.bad')).resolves.toBeNull();
    expect(reportError).not.toHaveBeenCalled();
  });

  it('a database failure during the account lookup reports once, and still returns null', async () => {
    vi.doMock('@/lib/db', () => ({
      getDb: () => {
        throw new Error('SQLITE_BUSY: database is locked');
      },
    }));
    const { createSessionToken, verifySessionToken } = await import('@/lib/session');
    const token = await createSessionToken({ id: 'acct-1', role: 'admin', mode: 'saas' });
    await expect(verifySessionToken(token)).resolves.toBeNull();
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(expect.any(Error), 'session lookup failed');
    vi.doUnmock('@/lib/db');
  });

  it('a missing SESSION_SECRET is a misconfiguration: reported', async () => {
    vi.stubEnv('SESSION_SECRET', '');
    const { verifySessionToken } = await import('@/lib/session');
    await expect(verifySessionToken('anything')).resolves.toBeNull();
    expect(reportError).toHaveBeenCalledWith(expect.any(Error), 'session lookup failed');
  });
});

describe('the proxy (§6.2)', () => {
  it('reports its own failure under /proxy and rethrows it', async () => {
    vi.resetModules();
    vi.doMock('@/lib/session', () => ({
      SESSION_COOKIE_NAME: 'license_console_session',
      verifySessionToken: () => {
        throw new Error('proxy boom');
      },
    }));
    const { proxy } = await import('@/proxy');
    const request = new NextRequest('http://localhost/dashboard', {
      headers: { cookie: 'license_console_session=tok' },
    });
    await expect(proxy(request)).rejects.toThrow('proxy boom');
    expect(reportError).toHaveBeenCalledWith(expect.any(Error), 'proxy failed', '/proxy');
    vi.doUnmock('@/lib/session');
  });
});

describe('remote response bodies stay out of error messages (§8)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('Resend', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test-key-not-real');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{"message":"The to field must be jane@example.com"}', { status: 422 }))
    );
    const { createResendEmailProvider } = await import('@/lib/email/resend-provider');
    const err = await createResendEmailProvider()
      .sendSignupConfirmation('jane@example.com', 'http://localhost/confirm')
      .catch((e: unknown) => e as Error);
    expect((err as Error).message).toBe('Resend API responded with 422');
  });

  it('Discord', async () => {
    vi.stubEnv('NOTIFY_WEBHOOK_URL', 'https://discord.invalid/api/webhooks/1/x');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"message":"body with details"}', { status: 400 })));
    const { createDiscordNotificationProvider } = await import('@/lib/notifications/discord-provider');
    const err = await createDiscordNotificationProvider()
      .notify({ type: 'login', email: 'jane@example.com' } as never)
      .catch((e: unknown) => e as Error);
    expect((err as Error).message).toBe('Discord webhook responded with 400');
  });
});
