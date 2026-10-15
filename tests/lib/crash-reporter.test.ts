// lib/crash-reporter.ts: the hosted Console's error reporter
// (CRASH_REPORTING_DESIGN.md, faultline phase 1b). Section numbers are the
// design's. What only a built standalone server shows (one reporter across
// bundles, instanceof across bundles, Next's own handlers) is PR B's
// built-server test; this covers the logic.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetForTests,
  createReporter,
  reportError,
  reportRequestError,
  reporterSettings,
  startReporter,
  type ReportEvent,
  type ReporterSettings,
} from '@/lib/crash-reporter';
import { LicenseApiError } from '@/lib/errors';

const KEY = '0123456789abcdef0123456789abcdef';
const DSN = `https://${KEY}@errors.example.com/2`;

type Enabled = Extract<ReporterSettings, { enabled: true }>;

function enabledSettings(): Enabled {
  const s = reporterSettings({
    hosted: 'true',
    nodeEnv: 'production',
    dsn: DSN,
    environment: 'saas-test',
    sourceCommit: '26d1bfe0123456789abcdef0123456789abcdef0',
    version: '1.7.0',
  });
  if (!s.enabled) throw new Error('settings should be enabled');
  return s;
}

// A fake faultline: records every envelope and answers with `status`.
function fakeFetch(status = 200, headers: Record<string, string> = {}) {
  const calls: { url: string; init: RequestInit; events: ReportEvent[] }[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const lines = String(init.body).trim().split('\n');
    const events: ReportEvent[] = [];
    for (let i = 2; i < lines.length; i += 2) events.push(JSON.parse(lines[i]));
    calls.push({ url, init, events });
    return new Response(null, { status, headers });
  });
  return { fetch, calls, events: () => calls.flatMap((c) => c.events) };
}

function reporter(status = 200, headers: Record<string, string> = {}) {
  let now = 1_000_000;
  const f = fakeFetch(status, headers);
  const stderr: string[] = [];
  const r = createReporter(enabledSettings(), {
    fetch: f.fetch,
    now: () => now,
    stderr: (s) => {
      stderr.push(s);
    },
    cwd: '/app',
  });
  return { r, f, stderr, advance: (ms: number) => (now += ms) };
}

const ALLOWED_EVENT_KEYS = new Set([
  'event_id',
  'timestamp',
  'platform',
  'level',
  'release',
  'environment',
  'sdk',
  'tags',
  'exception',
  'fingerprint',
  'extra',
]);
const ALLOWED_TAGS = new Set(['route', 'method', 'error_code', 'source', 'logmessage', 'router', 'route_type']);

describe('reporterSettings (§4)', () => {
  const base = {
    hosted: 'true',
    nodeEnv: 'production',
    dsn: DSN,
    environment: 'saas',
    sourceCommit: '26d1bfe',
    version: '1.7.0',
  };

  it('is off, with no reason to log, unless CRASH_REPORT_HOSTED is exactly true', () => {
    expect(reporterSettings({ ...base, hosted: undefined })).toEqual({ enabled: false, reason: null });
    expect(reporterSettings({ ...base, hosted: 'TRUE' })).toEqual({ enabled: false, reason: null });
    expect(reporterSettings({ ...base, hosted: '1' })).toEqual({ enabled: false, reason: null });
  });

  it.each([
    [{ nodeEnv: 'development' }, 'NODE_ENV is not production'],
    [{ dsn: '' }, 'no CRASH_REPORT_DSN'],
    [{ dsn: 'not a url' }, 'CRASH_REPORT_DSN is not a URL'],
    [{ dsn: `http://${KEY}@errors.example.com/2` }, 'CRASH_REPORT_DSN must be https'],
    [{ dsn: 'https://short@errors.example.com/2' }, 'CRASH_REPORT_DSN has no valid key'],
    [{ dsn: `https://${KEY}:pw@errors.example.com/2` }, 'CRASH_REPORT_DSN has no valid key'],
    [{ dsn: `https://${KEY}@errors.example.com/` }, 'CRASH_REPORT_DSN has no project id'],
    [{ environment: '' }, 'CRASH_REPORT_ENVIRONMENT must be saas, saas-test or standalone'],
    [{ environment: 'mls' }, 'CRASH_REPORT_ENVIRONMENT must be saas, saas-test or standalone'],
  ])('is off for %o', (change, reason) => {
    expect(reporterSettings({ ...base, ...change })).toEqual({ enabled: false, reason });
  });

  it('allows http only for localhost, for the local test', () => {
    const s = reporterSettings({ ...base, dsn: `http://${KEY}@127.0.0.1:9000/2` });
    expect(s.enabled && s.endpoint).toBe('http://127.0.0.1:9000/api/2/envelope/');
  });

  it('builds the endpoint and release', () => {
    const s = reporterSettings({ ...base, sourceCommit: '26d1bfe0123456789abcdef0123456789abcdef0' });
    expect(s).toMatchObject({
      enabled: true,
      endpoint: 'https://errors.example.com/api/2/envelope/',
      key: KEY,
      environment: 'saas',
      release: '1.7.0+26d1bfe',
    });
  });

  it('says unknown for a missing or malformed commit or version', () => {
    expect(reporterSettings({ ...base, sourceCommit: '' })).toMatchObject({ release: '1.7.0+unknown' });
    expect(reporterSettings({ ...base, sourceCommit: 'main' })).toMatchObject({ release: '1.7.0+unknown' });
    expect(reporterSettings({ ...base, version: 'x y' })).toMatchObject({ release: 'unknown+26d1bfe' });
  });
});

describe('startReporter (§4, §5)', () => {
  const env = {
    CRASH_REPORT_HOSTED: 'true',
    NODE_ENV: 'production',
    CRASH_REPORT_DSN: DSN,
    CRASH_REPORT_ENVIRONMENT: 'saas-test',
    SOURCE_COMMIT: '26d1bfe',
    APP_VERSION: '1.7.0',
  } as unknown as NodeJS.ProcessEnv;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    __resetForTests();
    warn.mockRestore();
  });

  it('logs nothing and installs nothing when CRASH_REPORT_HOSTED is unset', () => {
    const before = process.listenerCount('unhandledRejection');
    expect(startReporter({ ...env, CRASH_REPORT_HOSTED: undefined })).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    expect(process.listenerCount('unhandledRejection')).toBe(before);
  });

  it('logs the off line once, not again on a second register()', () => {
    startReporter({ ...env, CRASH_REPORT_ENVIRONMENT: 'prod' });
    startReporter({ ...env, CRASH_REPORT_ENVIRONMENT: 'prod' });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('logs why when hosted but misconfigured, without the key', () => {
    expect(startReporter({ ...env, CRASH_REPORT_ENVIRONMENT: 'prod' })).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      'crash reporting off: CRASH_REPORT_ENVIRONMENT must be saas, saas-test or standalone'
    );
    __resetForTests();
    startReporter({ ...env, CRASH_REPORT_DSN: `https://${KEY}@errors.example.com/x` });
    expect(warn).toHaveBeenCalledTimes(2);
    for (const call of warn.mock.calls) expect(String(call[0])).not.toContain(KEY);
  });

  it('logs the boot line, without the key, and installs one of everything', () => {
    const rejections = process.listenerCount('unhandledRejection');
    const exceptions = process.listenerCount('uncaughtException');
    const r = startReporter(env, { fetch: fakeFetch().fetch });
    expect(r).not.toBeNull();
    expect(warn).toHaveBeenCalledWith('crash reporting on (environment=saas-test, release=1.7.0+26d1bfe)');
    for (const call of warn.mock.calls) expect(String(call[0])).not.toContain(KEY);
    expect(process.listenerCount('unhandledRejection')).toBe(rejections + 1);
    expect(process.listenerCount('uncaughtException')).toBe(exceptions + 1);
    expect(r!.timer!.hasRef()).toBe(false);
    // A second call (a dev reload) returns the same reporter and adds nothing.
    expect(startReporter(env)).toBe(r);
    expect(process.listenerCount('unhandledRejection')).toBe(rejections + 1);
    __resetForTests();
    expect(process.listenerCount('unhandledRejection')).toBe(rejections);
    expect(process.listenerCount('uncaughtException')).toBe(exceptions);
  });

  it('reaches the one reporter from reportError and reportRequestError', async () => {
    const f = fakeFetch();
    const r = startReporter(env, { fetch: f.fetch })!;
    reportError(new Error('one'), 'a site failed', '/api/signup');
    reportRequestError(new Error('two'), 'GET', { routePath: '/dashboard', routeType: 'render' });
    await r.flushAll();
    expect(f.events().map((e) => e.exception!.values[0].value)).toEqual(['one', 'two']);
  });

  it('does nothing, and never throws, when reporting is off', () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    expect(() => reportError(new Error('x'), 'label')).not.toThrow();
    expect(() => reportRequestError(new Error('x'), 'GET', undefined)).not.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
  });

  it("listeners report a process error and never throw, even if the reporter's internals do", async () => {
    const f = fakeFetch();
    const r = startReporter(env, { fetch: f.fetch })!;
    r.listeners!.unhandledRejection(new TypeError('late rejection'));
    await r.flushAll();
    expect(f.events()[0]).toMatchObject({ tags: { source: 'process', route: '<no-route>' } });
    r.options.now = () => {
      throw new Error('broken clock');
    };
    expect(() => r.listeners!.unhandledRejection(new Error('x'))).not.toThrow();
    expect(() => r.listeners!.uncaughtException(new Error('x'))).not.toThrow();
  });
});

describe('the event (§6)', () => {
  it('holds only fields faultline keeps', async () => {
    const { r, f } = reporter();
    const err = Object.assign(new Error('boom'), { code: 'SQLITE_BUSY', secretField: 'x' });
    r.requestError(err, 'POST', { routePath: '/licenses', routeType: 'action', routerKind: 'App Router' });
    r.reportError(new Error('boom'), 'a site failed', '/api/signup');
    r.processError(new Error('boom'));
    await r.flushAll();
    expect(f.events()).toHaveLength(3);
    for (const ev of f.events()) {
      for (const k of Object.keys(ev)) expect(ALLOWED_EVENT_KEYS.has(k)).toBe(true);
      for (const k of Object.keys(ev.tags)) expect(ALLOWED_TAGS.has(k)).toBe(true);
      expect(ev).toMatchObject({
        platform: 'node',
        level: 'error',
        release: '1.7.0+26d1bfe',
        environment: 'saas-test',
        sdk: { name: 'casazium.console', version: '1.7.0' },
      });
      expect(ev.event_id).toMatch(/^[0-9a-f]{32}$/);
    }
    expect(f.events()[0].tags).toEqual({
      route: '/licenses',
      source: 'response',
      method: 'POST',
      route_type: 'action',
      router: 'app',
      error_code: 'SQLITE_BUSY',
    });
  });

  it('sends the fingerprints faultline groups by', async () => {
    const { r, f } = reporter();
    r.requestError(new TypeError('Cannot read properties of undefined (reading \'id\')'), 'GET', {
      routePath: '/dashboard',
      routeType: 'render',
    });
    r.reportError(new Error('Resend API responded with 422'), 'signup confirmation email failed', '/api/signup');
    await r.flushAll();
    expect(f.events()[0].fingerprint).toEqual([
      '/dashboard',
      'TypeError',
      "Cannot read properties of undefined (reading 'id')",
    ]);
    // A site's issues: its label, kept apart by cause (§6).
    expect(f.events()[1].fingerprint).toEqual(['/api/signup', 'log', 'signup confirmation email failed', 'Error']);
    expect(f.events()[1].tags.logmessage).toBe('signup confirmation email failed');
  });

  it("keeps built-in names, LicenseApiError and SqliteError, and nothing else (a minified library's)", async () => {
    const { r, f } = reporter();
    class h extends Error {
      constructor(m: string) {
        super(m);
        this.name = 'h';
      }
    }
    r.processError(new h('jose failed'));
    r.processError(new LicenseApiError('Bad request', 400));
    r.processError(Object.assign(new Error('busy'), { name: 'SqliteError' }));
    r.processError(new RangeError('out of range'));
    await r.flushAll();
    expect(f.events().map((e) => e.exception!.values[0].type)).toEqual([
      'Error',
      'LicenseApiError',
      'SqliteError',
      'RangeError',
    ]);
  });

  it('names a thrown non-Error by its kind only', async () => {
    const { r, f } = reporter();
    r.requestError('jane@example.com was not found', 'GET', { routePath: '/x' });
    r.processError({ tenantId: 't1' });
    r.processError(undefined);
    r.processError(null);
    await r.flushAll();
    expect(f.events().map((e) => e.exception!.values[0])).toMatchObject([
      { type: 'Error', value: '<non-Error: string>' },
      { type: 'Error', value: '<non-Error: Object>' },
      { type: 'Error', value: '<non-Error: undefined>' },
      { type: 'Error', value: '<non-Error: null>' },
    ]);
  });

  it('sends a site with no error object as LogError, its label the value', async () => {
    const { r, f } = reporter();
    r.reportError(undefined, 'signup unavailable: License Server settings unset', '/api/signup');
    await r.flushAll();
    expect(f.events()[0].exception!.values[0]).toEqual({
      type: 'LogError',
      value: 'signup unavailable: License Server settings unset',
    });
  });

  it("takes error_code from a fetch failure's cause, when faultline accepts it", async () => {
    const { r, f } = reporter();
    r.processError(new TypeError('fetch failed', { cause: Object.assign(new Error('x'), { code: 'ECONNREFUSED' }) }));
    r.processError(new TypeError('fetch failed', { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } }));
    await r.flushAll();
    expect(f.events()[0].tags.error_code).toBe('ECONNREFUSED');
    expect(f.events()[1].tags.error_code).toBeUndefined();
  });

  it('cleans the value: no quoted request body, no email, no account id', async () => {
    const { r, f } = reporter();
    r.requestError(new SyntaxError(`Unexpected token 'I', "Ignore thi"... is not valid JSON`), 'POST', {
      routePath: '/settings',
      routeType: 'action',
    });
    r.processError(new Error('No account 6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b for jane@example.com'));
    await r.flushAll();
    expect(f.events()[0].exception!.values[0].value).toBe('Unexpected token <q>, <q>... is not valid JSON');
    expect(f.events()[1].exception!.values[0].value).toBe('No account <uuid> for <email>');
  });

  it.each([
    ['/login/page', '/login'],
    ['/api/rt/[id]/route', '/api/rt/[id]'],
    ['/rt/grp/[id]', '/rt/grp/[id]'],
    ['/api/rt/all/[...slug]', '/api/rt/all/[...slug]'],
    ['/page', '/'],
    ['/(app)/settings', '<no-route>'],
    ['', '<no-route>'],
  ])('sends routePath %s as %s', async (routePath, want) => {
    const { r, f } = reporter();
    r.requestError(new Error('x'), 'GET', { routePath, routeType: 'render' });
    await r.flushAll();
    expect(f.events()[0].tags.route).toBe(want);
  });

  it("gives reportError a literal route, <no-route> without one, and route_type proxy for the proxy", async () => {
    const { r, f } = reporter();
    r.reportError(new Error('a'), 'session lookup failed');
    r.reportError(new Error('b'), 'proxy failed', '/proxy');
    r.reportError(new Error('c'), 'x', 'not a route');
    await r.flushAll();
    expect(f.events().map((e) => [e.tags.route, e.tags.route_type])).toEqual([
      ['<no-route>', undefined],
      ['/proxy', 'proxy'],
      ['<no-route>', undefined],
    ]);
  });

  it('strips the working directory and .next/server/ from frames', async () => {
    const { r, f } = reporter();
    const err = new Error('boom');
    err.stack = [
      'Error: boom',
      '    at b (/app/.next/server/chunks/ssr/[root-of-the-server]__1i_bjp0._.js:1:1191)',
      '    at eP (/app/node_modules/next/dist/compiled/next-server/app-page-turbo.runtime.prod.js:5:57254)',
    ].join('\n');
    r.processError(err);
    await r.flushAll();
    expect(f.events()[0].exception!.values[0].stacktrace!.frames).toEqual([
      {
        function: 'eP',
        filename: 'node_modules/next/dist/compiled/next-server/app-page-turbo.runtime.prod.js',
        lineno: 5,
        colno: 57254,
        in_app: false,
      },
      { function: 'b', filename: 'chunks/ssr/[root-of-the-server]__1i_bjp0._.js', lineno: 1, colno: 1191, in_app: true },
    ]);
  });

  it('ignores React postpones, as Next does', async () => {
    const { r, f } = reporter();
    r.processError({ $$typeof: Symbol.for('react.postpone'), reason: 'x' });
    await r.flushAll();
    expect(f.calls).toHaveLength(0);
  });
});

describe('counted, not reported (§3)', () => {
  // Built from a different class with the right name: the check must read
  // name and status, never instanceof (each bundle has its own class).
  class OtherBundleLicenseApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = 'LicenseApiError';
      this.status = status;
    }
  }

  it.each([
    ['a rejected tenant', new OtherBundleLicenseApiError('Unauthorized', 403)],
    ['a rejected tenant (the real class)', new LicenseApiError('Unauthorized', 403)],
    ['a revoked session', new Error('Unauthorized')],
    ['a cross-origin action POST', new Error('Invalid Server Actions request.')],
    ['a junk multipart body', new TypeError('Failed to parse body as FormData.')],
    [
      'an unknown action',
      new Error('Failed to find Server Action. This request might be from an older or newer deployment.'),
    ],
    ['a malformed router state header', new Error('The router state header was sent but could not be parsed.')],
  ])('counts %s', async (_name, err) => {
    const { r, f } = reporter();
    r.requestError(err, 'POST', { routePath: '/login/page', routeType: 'render' });
    r.requestError(err, 'POST', { routePath: '/login/page', routeType: 'render' });
    await r.flushAll();
    expect(f.events()).toHaveLength(1);
    expect(f.events()[0]).toMatchObject({
      tags: { route: '/login', source: 'log4xx' },
      fingerprint: ['/login', 'LOG4XX'],
      extra: { sample_weight: 2 },
    });
  });

  it.each([
    ['a 403 Forbidden from a proxy', new OtherBundleLicenseApiError('Forbidden', 403)],
    ['an inactive subscription', new LicenseApiError('Subscription is not active', 403)],
    ['a 401', new LicenseApiError('Unauthorized', 401)],
    ['a rethrown 400', new LicenseApiError('expires_at must be a date', 400)],
    ['a rethrown 409', new LicenseApiError('Already exists', 409)],
    ['a 503', new LicenseApiError('Failed to load licenses: 503 Service Unavailable', 503)],
    ['a truncated action body', new Error('Unexpected end of form')],
    ['a network failure', new TypeError('fetch failed')],
  ])('reports %s', async (_name, err) => {
    const { r, f } = reporter();
    r.requestError(err, 'POST', { routePath: '/licenses', routeType: 'action' });
    await r.flushAll();
    expect(f.events()).toHaveLength(1);
    expect(f.events()[0].tags.source).toBe('response');
  });
});

describe('dedupe (§9)', () => {
  it('sends a repeat within 10 s once, then its count', async () => {
    const { r, f, advance } = reporter();
    for (let i = 0; i < 5; i++) r.reportError(new Error(`row ${100 + i} failed`), 'a site failed', '/x');
    await r.flushAll();
    // Values differ only by a number, so one fingerprint: the first event,
    // then the four repeats as one event of weight 4.
    expect(f.events().map((e) => e.extra?.sample_weight ?? 1)).toEqual([1, 4]);
    advance(11_000);
    r.reportError(new Error('row 200 failed'), 'a site failed', '/x');
    await r.flushAll();
    expect(f.events()).toHaveLength(3);
  });

  it('sends one Overflow event past 200 fingerprints', async () => {
    const { r, f } = reporter();
    for (let i = 0; i < 205; i++) r.reportError(new Error('x'), `site ${String.fromCharCode(65 + (i % 26))}${i}`, '/x');
    await r.flushAll();
    const overflow = f.events().filter((e) => e.exception!.values[0].type === 'Overflow');
    // The first Overflow, then the other four as one repeat of weight 4.
    expect(overflow.map((e) => e.extra?.sample_weight ?? 1)).toEqual([1, 4]);
    expect(f.events()).toHaveLength(202);
  });

  it('sends 4xx counts once a minute', async () => {
    const { r, f, advance } = reporter();
    advance(60_000);
    r.requestError(new Error('Unauthorized'), 'GET', { routePath: '/dashboard' });
    r.tick();
    await Promise.resolve();
    await r.inFlight;
    expect(f.events()).toHaveLength(1);
    r.requestError(new Error('Unauthorized'), 'GET', { routePath: '/dashboard' });
    advance(1_000);
    r.tick();
    await r.inFlight;
    expect(f.events()).toHaveLength(1); // not before the minute is up
  });
});

describe('sending (§9)', () => {
  it('posts an envelope with the key, no redirects and no Next data cache', async () => {
    const { r, f } = reporter();
    r.processError(new Error('x'));
    await r.flushAll();
    const { url, init } = f.calls[0];
    expect(url).toBe('https://errors.example.com/api/2/envelope/');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect(init.cache).toBe('no-store');
    expect((init.headers as Record<string, string>)['X-Sentry-Auth']).toBe(
      `Sentry sentry_version=7, sentry_key=${KEY}, sentry_client=casazium-console/1.7.0`
    );
    expect(String(init.body).split('\n')[1]).toBe('{"type":"event"}');
  });

  it('keeps one send in flight, 50 events a batch', async () => {
    const { r, f } = reporter();
    for (let i = 0; i < 120; i++) r.reportError(new Error('x'), `label ${String.fromCharCode(65 + (i % 26))}${i}`, '/x');
    r.tick();
    const first = r.inFlight;
    r.tick(); // the first is still in flight: no second send
    expect(r.inFlight).toBe(first);
    await first;
    expect(f.fetch).toHaveBeenCalledTimes(1);
    await r.flushAll();
    expect(f.calls.map((c) => c.events.length)).toEqual([50, 50, 20]);
  });

  it('pauses on a 429, reading X-Sentry-Rate-Limits before Retry-After, and keeps the batch', async () => {
    const { r, f } = reporter(429, { 'x-sentry-rate-limits': '30::key', 'retry-after': '90' });
    r.processError(new Error('x'));
    r.tick();
    await r.inFlight;
    expect(r.pausedUntil - r.options.now()).toBe(30_000);
    expect(r.queue).toHaveLength(1);
    r.tick();
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });

  it('pauses 10 minutes on a 403, warning at most once an hour', async () => {
    const { r, stderr, advance } = reporter(403);
    r.processError(new Error('x'));
    r.tick();
    await r.inFlight;
    expect(r.pausedUntil - r.options.now()).toBe(10 * 60 * 1000);
    expect(stderr).toEqual(['crash reporting refused (HTTP 403); pausing for 10 minutes\n']);
    advance(11 * 60 * 1000);
    r.tick();
    await r.inFlight;
    expect(stderr).toHaveLength(1);
  });

  it('drops a batch on another answer and says how many errors it stood for', async () => {
    const { r, stderr, advance } = reporter(500);
    for (let i = 0; i < 3; i++) r.reportError(new Error('x'), 'same site', '/x');
    await r.flushAll();
    expect(r.queue).toHaveLength(0);
    advance(61_000);
    r.tick();
    expect(stderr).toEqual(['crash reporting: 2 reports (3 errors) dropped\n']);
  });

  it('counts a failed send as dropped and never throws', async () => {
    const r = createReporter(enabledSettings(), {
      fetch: async () => {
        throw new Error('network down');
      },
    });
    r.processError(new Error('x'));
    await r.flushAll();
    expect(r.dropped).toBe(1);
  });
});

describe('onRequestError (instrumentation.ts)', () => {
  afterEach(() => {
    __resetForTests();
    vi.restoreAllMocks();
    delete process.env.NEXT_RUNTIME;
  });

  it('reads only the method from the request', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = fakeFetch();
    const r = startReporter(
      {
        CRASH_REPORT_HOSTED: 'true',
        NODE_ENV: 'production',
        CRASH_REPORT_DSN: DSN,
        CRASH_REPORT_ENVIRONMENT: 'saas-test',
        APP_VERSION: '1.7.0',
      } as unknown as NodeJS.ProcessEnv,
      { fetch: f.fetch }
    )!;
    process.env.NEXT_RUNTIME = 'nodejs';
    const { onRequestError } = await import('@/instrumentation');
    // path carries the query string, headers the cookies: reading either fails the test.
    const request = new Proxy(
      { method: 'GET' },
      {
        get(target, prop) {
          if (prop === 'method') return target.method;
          throw new Error(`read request.${String(prop)}`);
        },
      }
    );
    await onRequestError(new Error('render failed'), request, { routePath: '/dashboard', routeType: 'render' });
    await r.flushAll();
    expect(f.events()).toHaveLength(1);
    expect(f.events()[0].tags).toMatchObject({ route: '/dashboard', method: 'GET', route_type: 'render' });
  });
});

describe('the gaps the PR A review found', () => {
  it('never throws from requestError, reportError or processError', () => {
    const { r } = reporter();
    const hostile = new Proxy(new Error('x'), {
      get(target, prop) {
        if (prop === 'message' || prop === 'name' || prop === 'stack') throw new Error('hostile getter');
        return Reflect.get(target, prop);
      },
    });
    expect(() => r.requestError(hostile, 'GET', { routePath: '/x' })).not.toThrow();
    expect(() => r.reportError(hostile, 'a site failed', '/x')).not.toThrow();
    expect(() => r.processError(hostile)).not.toThrow();
    r.options.now = () => {
      throw new Error('broken clock');
    };
    expect(() => r.requestError(new Error('x'), 'GET', { routePath: '/x' })).not.toThrow();
    expect(() => r.reportError(new Error('x'), 'a site failed')).not.toThrow();
    expect(() => r.tick()).not.toThrow();
  });

  it('pauses 10 minutes on a 404 too', async () => {
    const { r } = reporter(404);
    r.processError(new Error('x'));
    r.tick();
    await r.inFlight;
    expect(r.pausedUntil - r.options.now()).toBe(10 * 60 * 1000);
    expect(r.queue).toHaveLength(1);
  });

  it('caps the queue at 500 and counts the rest as dropped', () => {
    const { r } = reporter();
    for (let i = 0; i < 510; i++) r.reportError(new Error('x'), `label ${i} ${String.fromCharCode(65 + (i % 26))}`, '/x');
    // 200 fingerprints, then Overflow: the queue holds what it may, and nothing more than 500.
    expect(r.queue.length).toBeLessThanOrEqual(500);
    const many = createReporter(enabledSettings(), { fetch: fakeFetch().fetch, maxFingerprints: 10000 });
    // Letters only: the fingerprint's template turns numbers into <n>.
    const letters = (i: number) => String.fromCharCode(97 + (i % 26), 97 + (Math.floor(i / 26) % 26));
    for (let i = 0; i < 510; i++) many.reportError(new Error('x'), `label ${letters(i)}`, '/x');
    expect(many.queue).toHaveLength(500);
    expect(many.dropped).toBe(10);
  });

  it('gives each send a timeout signal', async () => {
    const { r, f } = reporter();
    r.processError(new Error('x'));
    await r.flushAll();
    expect(f.calls[0].init.signal).toBeInstanceOf(AbortSignal);
    const hung = createReporter(enabledSettings(), {
      timeoutMs: 20,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    });
    hung.processError(new Error('x'));
    await hung.flushAll();
    expect(hung.dropped).toBe(1);
  });

  it('leaves out a method or route type faultline would reject', async () => {
    const { r, f } = reporter();
    r.requestError(new Error('x'), 'get', { routePath: '/x', routeType: 'middleware', routerKind: 'Other' });
    await r.flushAll();
    expect(f.events()[0].tags).toEqual({ route: '/x', source: 'response' });
  });

  it("cleans and cuts logmessage to faultline's 120 characters", async () => {
    const { r, f } = reporter();
    r.reportError(new Error('x'), `a site failed ${'word '.repeat(60)}`, '/x');
    await r.flushAll();
    expect(Array.from(f.events()[0].tags.logmessage).length).toBeLessThanOrEqual(120);
  });

  it('keeps at most 50 frames', async () => {
    const { r, f } = reporter();
    const err = new Error('deep');
    err.stack = ['Error: deep', ...Array.from({ length: 80 }, (_, i) => `    at f${i} (/app/lib/x.js:${i + 1}:1)`)].join('\n');
    r.processError(err);
    await r.flushAll();
    expect(f.events()[0].exception!.values[0].stacktrace!.frames).toHaveLength(50);
  });

  it('cleans a repeated value once (the cache)', async () => {
    const { r } = reporter();
    const big = `boom ${'x1y2z3 '.repeat(100000)}`;
    let start = performance.now();
    r.processError(new Error(big));
    const first = performance.now() - start;
    start = performance.now();
    r.processError(new Error(big));
    const second = performance.now() - start;
    expect(second).toBeLessThan(first);
    expect(r.cleaned.size).toBe(1);
  });
});

