// lib/crash-reporter.ts
//
// Reports the hosted Console's server errors to faultline, Casazium's own
// error service (faultline phase 1b). CRASH_REPORTING_DESIGN.md is the
// design; section numbers below are its. Off unless CRASH_REPORT_HOSTED=true
// and a valid DSN and environment are set (§4): a self-hosted install never
// reports.
//
// In short:
// - instrumentation.ts's register() calls startReporter() once. It keeps one
//   reporter, methods and state together, on globalThis (§5): Turbopack gives
//   each bundle its own copy of this module, so nothing lives in module scope.
// - onRequestError (instrumentation.ts) hands request errors to
//   requestError(); reportError() is for the sites that catch and log (§6.1).
//   Both only enqueue.
// - A 1-second interval started here, outside any request, sends the queue
//   (§9), so Next's request-scoped fetch never sees a send.
// - Process errors are reported and nothing else: Next keeps serving after
//   them, and so does the Console (§7).
//
// Ported from casazium/license's src/lib/error-reporter.js (phase 1a); the
// differences are the design's (§3, §6, §7, §9). Never `instanceof` against an
// app class here: each bundle has its own copy of it (§3).

import crypto from 'node:crypto';
import fs from 'node:fs';
import util from 'node:util';
import { clean, cleanValue, stable, template, truncate } from './error-mask';
import { getAppVersion } from './version';

// faultline's patterns (its internal/scrub): anything that doesn't match is
// left out rather than sent and rejected.
const ROUTE = /^(<no-route>|\/[A-Za-z0-9_\-./:[\]*]{0,199})$/;
const METHOD = /^[A-Z]{3,7}$/;
const ERROR_CODE = /^(SQLITE|ERR|FST|E)[A-Z0-9_]{0,60}$/;
const RELEASE = /^[A-Za-z0-9_.+@:/-]{1,100}$/;
const COMMIT = /^[0-9a-f]{7,40}$/;
const KEY = /^[0-9a-f]{32}$/;
const ROUTE_TYPES = new Set(['render', 'route', 'action', 'proxy']);
const ENVIRONMENTS = new Set(['saas', 'saas-test', 'standalone']);

// §6: built-in names, plus two the code sets literally. Anything else (a
// bundled library's minified class name) becomes Error.
const KNOWN_TYPES = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'EvalError',
  'URIError',
  'AggregateError',
  'LicenseApiError',
  'SqliteError',
]);

const MAX_LOGMESSAGE = 120;
const MAX_FILENAME = 300;
const MAX_NAME = 200;
const MAX_FRAMES = 50;
const MAX_WEIGHT = 1000000;
const NUL = String.fromCharCode(0);

const GLOBAL_KEY = Symbol.for('casazium.console.crashReporter');
// Set once the settings have been read and found off, so a second
// register() (a dev reload) doesn't log the off line again.
const OFF_KEY = Symbol.for('casazium.console.crashReporter.off');

export type ReporterSettings =
  | {
      enabled: true;
      endpoint: string;
      key: string;
      environment: string;
      release: string;
      version: string;
    }
  | { enabled: false; reason: string | null };

export type SettingsInput = {
  hosted?: string;
  nodeEnv?: string;
  dsn?: string;
  environment?: string;
  sourceCommit?: string;
  version?: string;
};

/**
 * Reads the reporter's settings (§4). Never throws: a bad setting turns
 * reporting off, with the reason. reason is null when CRASH_REPORT_HOSTED is
 * unset, so a self-hosted install logs nothing about reporting.
 */
export function reporterSettings(input: SettingsInput): ReporterSettings {
  if (input.hosted !== 'true') return { enabled: false, reason: null };
  const off = (reason: string): ReporterSettings => ({ enabled: false, reason });
  if (input.nodeEnv !== 'production') return off('NODE_ENV is not production');
  if (!input.dsn) return off('no CRASH_REPORT_DSN');
  let url: URL;
  try {
    url = new URL(input.dsn);
  } catch {
    return off('CRASH_REPORT_DSN is not a URL');
  }
  const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    return off('CRASH_REPORT_DSN must be https');
  }
  if (!KEY.test(url.username) || url.password) return off('CRASH_REPORT_DSN has no valid key');
  const parts = url.pathname.split('/').filter(Boolean);
  const project = parts.pop();
  if (!project || !/^[0-9]+$/.test(project)) return off('CRASH_REPORT_DSN has no project id');
  const environment = input.environment || '';
  if (!ENVIRONMENTS.has(environment)) {
    return off('CRASH_REPORT_ENVIRONMENT must be saas, saas-test or standalone');
  }
  const base = parts.length ? `/${parts.join('/')}` : '';
  const version = input.version && RELEASE.test(input.version) && !input.version.includes('//') ? input.version : 'unknown';
  const commit = input.sourceCommit && COMMIT.test(input.sourceCommit) ? input.sourceCommit.slice(0, 7) : 'unknown';
  return {
    enabled: true,
    endpoint: `${url.protocol}//${url.host}${base}/api/${project}/envelope/`,
    key: url.username,
    environment,
    release: `${version}+${commit}`,
    version,
  };
}

export type ReporterOptions = {
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  now?: () => number;
  stderr?: (s: string) => void;
  cwd?: string;
  flushMs?: number;
  dedupeMs?: number;
  log4xxMs?: number;
  pauseOnRefusalMs?: number;
  timeoutMs?: number;
  maxQueue?: number;
  batch?: number;
  maxFingerprints?: number;
};

type Options = Required<ReporterOptions>;

const defaults: Options = {
  fetch: (url, init) => globalThis.fetch(url, init),
  now: () => Date.now(),
  stderr: (s) => {
    fs.writeSync(2, s);
  },
  cwd: '',
  flushMs: 1000,
  dedupeMs: 10000,
  log4xxMs: 60000,
  pauseOnRefusalMs: 10 * 60 * 1000,
  timeoutMs: 2000,
  maxQueue: 500,
  batch: 50,
  maxFingerprints: 200,
};

type Frame = { function: string; filename: string; lineno: number; colno: number; in_app: boolean };

export type ReportEvent = {
  event_id: string;
  timestamp: string;
  platform: 'node';
  level: 'error';
  release: string;
  environment: string;
  sdk: { name: string; version: string };
  tags: Record<string, string>;
  exception?: { values: { type: string; value: string; stacktrace?: { frames: Frame[] } }[] };
  fingerprint: string[];
  extra?: { sample_weight: number };
};

type Context = { route: string; method?: string; routeType?: string; router?: string };

type Window = { sentAt: number; suppressed: number; last: ReportEvent | null };

/** What Next passes onRequestError as its third argument (§6). */
export type RequestErrorContext = {
  routePath?: string;
  routeType?: string;
  routerKind?: string;
};

export type Reporter = {
  settings: Extract<ReporterSettings, { enabled: true }>;
  options: Options;
  queue: ReportEvent[];
  windows: Map<string, Window>;
  log4xx: Map<string, number>;
  pausedUntil: number;
  inFlight: Promise<void> | null;
  dropped: number;
  droppedErrors: number;
  lastStderr: number;
  lastWarn: number;
  lastLog4xxFlush: number;
  cleaned: Map<string, string>;
  timer: ReturnType<typeof setInterval> | null;
  listeners: { uncaughtException: (e: unknown) => void; unhandledRejection: (r: unknown) => void } | null;
  requestError: (err: unknown, method: unknown, ctx: RequestErrorContext | undefined) => void;
  reportError: (err: unknown, label: string, route?: string) => void;
  processError: (reason: unknown) => void;
  tick: () => void;
  flushAll: () => Promise<void>;
  stop: () => void;
};

/**
 * Builds a reporter. Tests call it directly; production goes through
 * startReporter(), which keeps the one instance on globalThis.
 */
export function createReporter(
  settings: Extract<ReporterSettings, { enabled: true }>,
  options: ReporterOptions = {}
): Reporter {
  const o: Options = { ...defaults, ...options };
  const r = {
    settings,
    options: o,
    queue: [],
    windows: new Map(),
    log4xx: new Map(),
    pausedUntil: 0,
    inFlight: null,
    dropped: 0,
    droppedErrors: 0,
    // So the first refusal warning and drop line are never held back.
    lastStderr: -Infinity,
    lastWarn: -Infinity,
    lastLog4xxFlush: 0,
    cleaned: new Map(),
    timer: null,
    listeners: null,
  } as unknown as Reporter;

  // Each entry point catches everything: reporting must never break the
  // request, the action or the process it's reporting on.
  r.requestError = (err, method, ctx) => {
    try {
      const route = requestRoute(ctx);
      if (isCounted(err)) {
        r.log4xx.set(route, (r.log4xx.get(route) || 0) + 1);
        return;
      }
      const c: Context = { route };
      if (typeof method === 'string' && METHOD.test(method)) c.method = method;
      if (ctx && typeof ctx.routeType === 'string' && ROUTE_TYPES.has(ctx.routeType)) c.routeType = ctx.routeType;
      if (ctx && ctx.routerKind === 'App Router') c.router = 'app';
      else if (ctx && ctx.routerKind === 'Pages Router') c.router = 'pages';
      queueEvent(r, errorEvent(r, err, c, 'response', null));
    } catch {
      drop(r, [null]);
    }
  };

  r.reportError = (err, label, route) => {
    try {
      const c: Context = { route: route && ROUTE.test(route) ? route : '<no-route>' };
      if (route === '/proxy') c.routeType = 'proxy';
      queueEvent(r, errorEvent(r, err, c, 'log', label, err === undefined || err === null));
    } catch {
      drop(r, [null]);
    }
  };

  r.processError = (reason) => {
    try {
      if (isPostpone(reason)) return; // React's, as Next ignores them (§7)
      queueEvent(r, errorEvent(r, reason, { route: '<no-route>' }, 'process', null));
    } catch {
      drop(r, [null]);
    }
  };

  r.tick = () => {
    try {
      tick(r, o);
    } catch {
      // never let the interval throw
    }
  };

  // For tests: queue everything waiting and send until the queue is empty.
  r.flushAll = async () => {
    flushWindows(r, o, true);
    flushLog4xx(r, o, true);
    for (let i = 0; i < 100 && (r.queue.length || r.inFlight); i++) {
      if (r.inFlight) await r.inFlight;
      else await send(r, o);
    }
  };

  r.stop = () => {
    if (r.timer) clearInterval(r.timer);
    r.timer = null;
    if (r.listeners) {
      process.removeListener('uncaughtException', r.listeners.uncaughtException);
      process.removeListener('unhandledRejection', r.listeners.unhandledRejection);
      r.listeners = null;
    }
  };

  return r;
}

/**
 * Called once from register() (§5). Creates the reporter when the settings
 * allow, installs the process listeners and the send interval, and keeps it
 * on globalThis. Idempotent: a second call (a dev reload) returns the first.
 * Logs the boot line; logs nothing when CRASH_REPORT_HOSTED is unset.
 */
export function startReporter(env: NodeJS.ProcessEnv = process.env, options: ReporterOptions = {}): Reporter | null {
  const g = globalThis as unknown as Record<symbol, Reporter | boolean | undefined>;
  const existing = g[GLOBAL_KEY];
  if (existing && typeof existing === 'object') return existing;
  if (g[OFF_KEY]) return null;
  const settings = reporterSettings({
    hosted: env.CRASH_REPORT_HOSTED,
    nodeEnv: env.NODE_ENV,
    dsn: env.CRASH_REPORT_DSN,
    environment: env.CRASH_REPORT_ENVIRONMENT,
    sourceCommit: env.SOURCE_COMMIT,
    // APP_VERSION isn't in the runtime environment: next.config.mjs's env
    // block inlines it at build time, where process.env.APP_VERSION is
    // written literally (lib/version.ts). Tests pass it in env.
    version: env.APP_VERSION || getAppVersion().version,
  });
  if (!settings.enabled) {
    g[OFF_KEY] = true;
    if (settings.reason) console.warn(`crash reporting off: ${settings.reason}`);
    return null;
  }
  const r = createReporter(settings, { cwd: process.cwd(), ...options });
  r.listeners = {
    // Report only: no exit, no stderr (Next logs both), and never a throw.
    // A throwing unhandledRejection listener makes Next's filter skip the
    // later listeners, Next's own log line among them (§7).
    uncaughtException: (e) => r.processError(e),
    unhandledRejection: (reason) => r.processError(reason),
  };
  try {
    process.on('uncaughtException', r.listeners.uncaughtException);
    process.on('unhandledRejection', r.listeners.unhandledRejection);
    r.timer = setInterval(r.tick, r.options.flushMs);
    r.timer.unref();
  } catch (err) {
    r.stop(); // leave nothing installed behind
    throw err;
  }
  g[GLOBAL_KEY] = r;
  console.warn(`crash reporting on (environment=${settings.environment}, release=${settings.release})`);
  return r;
}

function current(): Reporter | undefined {
  const r = (globalThis as unknown as Record<symbol, unknown>)[GLOBAL_KEY];
  return r && typeof r === 'object' ? (r as Reporter) : undefined;
}

/**
 * Reports an error a site caught and carried on from (§6.1). label is a
 * string literal describing the site, with no values; route is the site's
 * literal route, or omitted for shared code. Never awaits, never throws, and
 * does nothing when reporting is off.
 */
export function reportError(err: unknown, label: string, route?: string): void {
  try {
    const r = current();
    if (r) r.reportError(err, label, route);
  } catch {
    // reporting must never break the caller
  }
}

/** For instrumentation.ts's onRequestError: reads only the method (§6). */
export function reportRequestError(err: unknown, method: unknown, ctx: RequestErrorContext | undefined): void {
  try {
    const r = current();
    if (r) r.requestError(err, method, ctx);
  } catch {
    // reporting must never break the request
  }
}

/** For tests: stops and forgets the global reporter. */
export function __resetForTests(): void {
  const r = current();
  if (r) r.stop();
  const g = globalThis as unknown as Record<symbol, unknown>;
  delete g[GLOBAL_KEY];
  delete g[OFF_KEY];
}

// requestRoute is ctx.routePath with one trailing /page or /route segment
// removed (an error that escapes Next's outer handler carries the raw
// srcPage, such as /login/page), validated, or <no-route> (§6).
function requestRoute(ctx: RequestErrorContext | undefined): string {
  const raw = ctx && typeof ctx.routePath === 'string' ? ctx.routePath : '';
  const route = raw.replace(/\/(?:page|route)$/, '') || (raw ? '/' : '');
  return ROUTE.test(route) ? route : '<no-route>';
}

// isCounted (§3): faults of the request, counted per route, never reported.
// By name and message, never instanceof (§3).
function isCounted(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: unknown; message?: unknown; status?: unknown };
  const message = typeof e.message === 'string' ? e.message : '';
  if (e.name === 'LicenseApiError' && e.status === 403 && message === 'Unauthorized') return true; // a rejected tenant
  if (e.name === 'Error' && message === 'Unauthorized') return true; // requireSession(): a revoked session
  // Next's own, from anonymous requests (§3): a cross-origin action POST, and
  // a multipart body Next decodes before any Console code runs.
  if (message === 'Invalid Server Actions request.') return true;
  if (message === 'Failed to parse body as FormData.') return true;
  if (message.startsWith('Failed to find Server Action.')) return true;
  // An RSC request (RSC: 1) with a malformed Next-Router-State-Tree header:
  // any GET to a public page can send one (the PR A review).
  if (message === 'The router state header was sent but could not be parsed.') return true;
  return false;
}

// isPostpone is Next's check for React's postpone signal.
function isPostpone(reason: unknown): boolean {
  return (
    !!reason &&
    typeof reason === 'object' &&
    (reason as { $$typeof?: unknown }).$$typeof === Symbol.for('react.postpone')
  );
}

function baseEvent(r: Reporter, ctx: Context, source: string): ReportEvent {
  const tags: Record<string, string> = { route: ctx.route, source };
  if (ctx.method) tags.method = ctx.method;
  if (ctx.routeType) tags.route_type = ctx.routeType;
  if (ctx.router) tags.router = ctx.router;
  return {
    event_id: crypto.randomUUID().split('-').join(''),
    timestamp: new Date(r.options.now()).toISOString(),
    platform: 'node',
    level: 'error',
    release: r.settings.release,
    environment: r.settings.environment,
    sdk: { name: 'casazium.console', version: r.settings.version },
    tags,
    fingerprint: [],
  };
}

// kindOf names a non-Error by its kind only: its contents may hold customer
// data, and unlike an Error's message it isn't text the code wrote (§6).
// The kind is the prototype's constructor, never the object's own
// `constructor` field: a thrown parsed-JSON object could carry one whose
// name is customer data. Only an identifier-shaped name is used.
function kindOf(v: unknown): string {
  if (v === null) return 'null';
  let kind: string = typeof v;
  try {
    if (typeof v === 'object') {
      const proto = Object.getPrototypeOf(v) as { constructor?: { name?: unknown } } | null;
      const name = proto && proto.constructor ? proto.constructor.name : undefined;
      kind = typeof name === 'string' && /^[A-Za-z_$][A-Za-z0-9_$]{0,40}$/.test(name) ? name : 'object';
    }
  } catch {
    // a hostile getter or proxy: keep the typeof
  }
  return kind;
}

function errorCode(err: { code?: unknown; cause?: unknown }): string | null {
  if (typeof err.code === 'string' && ERROR_CODE.test(err.code)) return err.code;
  const cause = err.cause as { code?: unknown } | undefined;
  if (cause && typeof cause === 'object' && typeof cause.code === 'string' && ERROR_CODE.test(cause.code)) {
    return cause.code; // fetch failed: ECONNREFUSED and the like
  }
  return null;
}

// errorEvent builds an event for an error (or a non-Error), from a request
// (source response), a site (log, with its label) or the process (§6).
function errorEvent(
  r: Reporter,
  err: unknown,
  ctx: Context,
  source: string,
  label: string | null,
  noErrorObject = false
): ReportEvent {
  const ev = baseEvent(r, ctx, source);
  let type: string;
  let raw: string;
  let stack: string | null = null;
  let message = '';
  if (util.types.isNativeError(err)) {
    const e = err as Error & { code?: unknown; cause?: unknown };
    type = KNOWN_TYPES.has(e.name) ? e.name : 'Error';
    message = typeof e.message === 'string' ? e.message : '';
    raw = message;
    stack = typeof e.stack === 'string' ? e.stack : null;
    const code = errorCode(e);
    if (code) ev.tags.error_code = code;
  } else if (noErrorObject) {
    // A site with no error object (signup's missing settings): its label.
    type = 'LogError';
    raw = label || 'error logged';
  } else {
    // A thrown or rejected non-Error, undefined and null included.
    type = 'Error';
    raw = `<non-Error: ${kindOf(err)}>`;
  }
  if (label) ev.tags.logmessage = stable((s) => clean(s, MAX_LOGMESSAGE), label);
  const value = cachedClean(r, type, raw);
  const exception: { type: string; value: string; stacktrace?: { frames: Frame[] } } = { type, value };
  const frames = stack ? parseFrames(stack, message, r.options.cwd) : [];
  if (frames.length) exception.stacktrace = { frames };
  ev.exception = { values: [exception] };
  const cause = fp(ev.tags.error_code || type);
  ev.fingerprint =
    source === 'log' && label
      ? [fp(ev.tags.route), 'log', fp(label), cause] // §6: a site's issues apart by cause
      : [fp(ev.tags.route), cause, fp(value)];
  return ev;
}

// cachedClean is cleanValue, remembered: a storm repeats the same few
// errors, and masking a long value costs milliseconds on the request's
// thread (as 1a's cache). cleanValue reads at most 4,000 code points, which
// 8,000 code units always contain, so the key needn't hold more. The key is
// a hash of that: a slice of a message can keep the whole message alive
// (the PR A verification measured 225 MB for 100 two-megabyte messages).
function cachedClean(r: Reporter, type: string, raw: string): string {
  const key = crypto
    .createHash('sha256')
    .update(`${type}${NUL}${raw.length <= 8000 ? raw : `${raw.slice(0, 8000)}${NUL}long`}`)
    .digest('base64');
  const hit = r.cleaned.get(key);
  if (hit !== undefined) return hit;
  let value = cleanValue(type, raw);
  if (value === '') value = '<empty>';
  if (r.cleaned.size >= 200) r.cleaned.clear();
  r.cleaned.set(key, value);
  return value;
}

// fp is a fingerprint part already in faultline's final form.
function fp(s: string): string {
  return stable(template, s);
}

function log4xxEvent(r: Reporter, route: string, count: number): ReportEvent {
  const ev = baseEvent(r, { route }, 'log4xx');
  ev.exception = { values: [{ type: 'Log4xx', value: 'error counted, not reported' }] };
  ev.fingerprint = [fp(route), 'LOG4XX'];
  setWeight(ev, count);
  return ev;
}

function overflowEvent(r: Reporter, like: ReportEvent): ReportEvent {
  const ev = baseEvent(r, { route: like.tags.route }, like.tags.source);
  ev.exception = { values: [{ type: 'Overflow', value: '<too many distinct errors>' }] };
  ev.fingerprint = [fp(like.tags.route), 'OVERFLOW'];
  return ev;
}

function setWeight(ev: ReportEvent, n: number) {
  const w = Math.min(Math.max(Math.trunc(n), 1), MAX_WEIGHT);
  if (w > 1) ev.extra = { sample_weight: w };
  else delete ev.extra;
}

const FRAME = /^\s*at (?:(.*?) \()?(.*?):(\d+):(\d+)\)?\s*$/;

// parseFrames reads V8's stack (newest first) into Sentry frames, oldest
// first. File names lose the working directory and .next/server/, so no
// machine path is sent (§6).
function parseFrames(stack: string, message: string, cwd: string): Frame[] {
  const frames: Frame[] = [];
  // The stack starts with "Name: message", which may span lines.
  const skip = 1 + message.split('\n').length - 1;
  for (const line of stack.split('\n').slice(skip)) {
    const m = FRAME.exec(line);
    if (!m) continue;
    let filename = m[2].startsWith('file://') ? m[2].slice(7) : m[2];
    if (cwd && filename.startsWith(`${cwd}/`)) filename = filename.slice(cwd.length + 1);
    if (filename.startsWith('.next/server/')) filename = filename.slice('.next/server/'.length);
    frames.push({
      function: truncate((m[1] || '').trim(), MAX_NAME),
      filename: stable((s) => clean(s, MAX_FILENAME), filename),
      lineno: Number(m[3]),
      colno: Number(m[4]),
      in_app: !filename.includes('node_modules/') && !filename.startsWith('node:'),
    });
    if (frames.length === MAX_FRAMES) break;
  }
  return frames.reverse();
}

// queueEvent applies the 10-second duplicate window and the fingerprint cap
// (§9), keyed on the fingerprint for every source.
function queueEvent(r: Reporter, evIn: ReportEvent) {
  let ev = evIn;
  const o = r.options;
  const now = o.now();
  let id = ev.fingerprint.join(NUL);
  let entry = r.windows.get(id);
  if (!entry && r.windows.size >= o.maxFingerprints) {
    ev = overflowEvent(r, ev);
    id = ev.fingerprint.join(NUL);
    entry = r.windows.get(id);
  }
  if (entry && now - entry.sentAt < o.dedupeMs) {
    entry.suppressed++;
    entry.last = ev;
    return;
  }
  setWeight(ev, 1 + (entry ? entry.suppressed : 0));
  r.windows.set(id, { sentAt: now, suppressed: 0, last: null });
  enqueue(r, ev);
}

// drop counts reports that won't be sent, and the errors they stood for.
function drop(r: Reporter, events: (ReportEvent | null)[]) {
  for (const ev of events) {
    r.dropped++;
    r.droppedErrors += (ev && ev.extra && ev.extra.sample_weight) || 1;
  }
}

function enqueue(r: Reporter, ev: ReportEvent) {
  if (r.queue.length >= r.options.maxQueue) {
    drop(r, [ev]);
    return;
  }
  r.queue.push(ev);
}

function flushWindows(r: Reporter, o: Options, force: boolean) {
  const now = o.now();
  for (const [id, entry] of r.windows) {
    if (entry.suppressed > 0 && entry.last && (force || now - entry.sentAt >= o.dedupeMs)) {
      const ev = entry.last;
      setWeight(ev, entry.suppressed);
      entry.sentAt = now;
      entry.suppressed = 0;
      entry.last = null;
      enqueue(r, ev);
    } else if (entry.suppressed === 0 && now - entry.sentAt >= o.dedupeMs) {
      r.windows.delete(id);
    }
  }
}

function flushLog4xx(r: Reporter, o: Options, force: boolean) {
  const now = o.now();
  if (!force && now - r.lastLog4xxFlush < o.log4xxMs) return;
  r.lastLog4xxFlush = now;
  for (const [route, count] of r.log4xx) enqueue(r, log4xxEvent(r, route, count));
  r.log4xx.clear();
}

function tick(r: Reporter, o: Options) {
  flushWindows(r, o, false);
  flushLog4xx(r, o, false);
  reportDrops(r, o);
  if (!r.inFlight && r.queue.length && o.now() >= r.pausedUntil) {
    void send(r, o);
  }
}

function envelope(events: ReportEvent[], now: number): string {
  const lines = [JSON.stringify({ sent_at: new Date(now).toISOString() })];
  for (const ev of events) {
    lines.push('{"type":"event"}');
    lines.push(JSON.stringify(ev));
  }
  return lines.join('\n') + '\n';
}

function requestInit(r: Reporter, o: Options, events: ReportEvent[]): RequestInit {
  const s = r.settings;
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-sentry-envelope',
      'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${s.key}, sentry_client=casazium-console/${s.version}`,
    },
    body: envelope(events, o.now()),
    signal: AbortSignal.timeout(o.timeoutMs),
    // Never follow a redirect: it would resend the key and the reports to
    // wherever the DSN host points (counted as a failed send instead).
    redirect: 'error',
    // Next's patched fetch: never its data cache (§9).
    cache: 'no-store',
  };
}

// send posts one batch; at most one is in flight (§9).
function send(r: Reporter, o: Options): Promise<void> {
  if (r.inFlight || !r.queue.length || o.now() < r.pausedUntil) return Promise.resolve();
  const batch = r.queue.splice(0, o.batch);
  const init = requestInit(r, o, batch);
  r.inFlight = Promise.resolve()
    .then(() => o.fetch(r.settings.endpoint, init))
    .then((res) => answer(r, o, res, batch))
    .catch(() => drop(r, batch))
    .finally(() => {
      r.inFlight = null;
    });
  return r.inFlight;
}

// answer applies faultline's reply to a batch (§9).
function answer(r: Reporter, o: Options, res: Response, batch: ReportEvent[]) {
  const status = res.status;
  if (res.body) res.body.cancel().catch(() => {});
  if (status >= 200 && status < 300) return;
  if (status === 429) {
    const header = res.headers.get('x-sentry-rate-limits') || '';
    let secs = parseFloat(header.split(':')[0]);
    if (!(secs > 0)) secs = parseFloat(res.headers.get('retry-after') || '');
    if (!(secs > 0)) secs = 60;
    r.pausedUntil = o.now() + secs * 1000;
    requeue(r, batch);
    return;
  }
  if (status === 403 || status === 404) {
    // Not a permanent stop: the proxy in front of faultline answers 404
    // while its container is replaced, and Cloudflare can answer 403.
    r.pausedUntil = o.now() + o.pauseOnRefusalMs;
    requeue(r, batch);
    if (o.now() - r.lastWarn >= 60 * 60 * 1000) {
      r.lastWarn = o.now();
      try {
        o.stderr(`crash reporting refused (HTTP ${status}); pausing for 10 minutes\n`);
      } catch {
        // stderr unavailable
      }
    }
    return;
  }
  drop(r, batch); // other 4xx, 5xx
}

function requeue(r: Reporter, batch: ReportEvent[]) {
  const room = Math.max(0, r.options.maxQueue - r.queue.length);
  drop(r, batch.slice(room));
  r.queue = batch.slice(0, room).concat(r.queue);
}

function reportDrops(r: Reporter, o: Options) {
  if (!r.dropped || o.now() - r.lastStderr < 60 * 1000) return;
  r.lastStderr = o.now();
  try {
    o.stderr(`crash reporting: ${r.dropped} reports (${r.droppedErrors} errors) dropped\n`);
  } catch {
    // stderr unavailable
  }
  r.dropped = 0;
  r.droppedErrors = 0;
}
