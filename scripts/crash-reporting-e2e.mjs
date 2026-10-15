#!/usr/bin/env node
// scripts/crash-reporting-e2e.mjs
//
// The built-server test for crash reporting (CRASH_REPORTING_DESIGN.md §11):
// the behaviour only a real `next build` and standalone server show - one
// reporter across bundles, name-based checks across bundles, Next's own
// process handlers, the proxy, the exact texts of Next's anonymous errors.
//
// It copies the repo to a scratch directory, adds the fixture routes
// (tests/crash-e2e/fixtures -> app/(crash-test)/) and a test-only patch to
// proxy.ts there, builds that copy, starts its standalone server against a
// local envelope recorder, drives every case, and checks what arrived. The
// fixtures never touch this tree, so they can't ship in the image.
//
// Usage: node scripts/crash-reporting-e2e.mjs [--record <dir>]
//   --record writes each event received as <dir>/console-<name>.envelope,
//   for faultline's golden test (testdata/envelopes).
// Takes about 75 s: 4xx counts are sent once a minute.

import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const recordDir = process.argv.includes('--record') ? process.argv[process.argv.indexOf('--record') + 1] : null;

const failures = [];
const check = (ok, what) => {
  if (!ok) failures.push(what);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- a scratch copy with the fixtures ---------------------------------------
// Inside the repo (git-ignored), so node_modules can be cloned on the same
// volume: Turbopack refuses a node_modules symlink that points outside the
// project, and `cp -c` (APFS) clones in seconds where a copy takes minutes.
fs.mkdirSync(path.join(repo, '.crash-e2e'), { recursive: true });
const work = fs.mkdtempSync(path.join(repo, '.crash-e2e', 'run-'));
const copy = path.join(work, 'repo');
console.log(`scratch copy: ${copy}`);
// Whatever happens below, the scratch copy goes, Ctrl-C included.
process.on('exit', () => fs.rmSync(work, { recursive: true, force: true }));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));
// Entry by entry: cpSync won't copy a directory into itself. Never any
// .env file or local data: the standalone server loads a .env it finds,
// and the test must run on its own settings alone, as in CI.
fs.mkdirSync(copy);
for (const entry of fs.readdirSync(repo)) {
  if (['.next', 'node_modules', '.git', 'coverage', '.crash-e2e', 'data'].includes(entry)) continue;
  if (entry.startsWith('.env')) continue;
  fs.cpSync(path.join(repo, entry), path.join(copy, entry), { recursive: true });
}
execFileSync('cp', [process.platform === 'darwin' ? '-cR' : '-R', path.join(repo, 'node_modules'), path.join(copy, 'node_modules')]);
fs.cpSync(path.join(repo, 'tests', 'crash-e2e', 'fixtures'), path.join(copy, 'app'), { recursive: true });

// Test-only proxy patch: /crash-test is public, and one path throws, since
// Next reports no proxy error itself (§6.2).
const proxyFile = path.join(copy, 'proxy.ts');
let proxySrc = fs.readFileSync(proxyFile, 'utf8');
proxySrc = proxySrc.replace("const PUBLIC_PATHS = [\n", "const PUBLIC_PATHS = [\n  '/crash-test',\n");
proxySrc = proxySrc.replace(
  'async function checkSession(request: NextRequest) {\n  const { pathname } = request.nextUrl;\n',
  "async function checkSession(request: NextRequest) {\n  const { pathname } = request.nextUrl;\n  if (pathname === '/crash-test/proxy-throw') throw new Error('proxy boom');\n"
);
if (!proxySrc.includes("'/crash-test',") || !proxySrc.includes('proxy boom')) {
  console.error('proxy.ts no longer matches the test patch; update scripts/crash-reporting-e2e.mjs');
  process.exit(1);
}
fs.writeFileSync(proxyFile, proxySrc);

// The copy sits inside the repo, so pin its own root: otherwise Next takes
// the outer repo (its lockfile) as the workspace root, and the standalone
// output lands elsewhere.
const configFile = path.join(copy, 'next.config.mjs');
const config = fs.readFileSync(configFile, 'utf8');
if (!config.includes('export default nextConfig;')) {
  console.error('next.config.mjs no longer ends with `export default nextConfig;`; update this script');
  process.exit(1);
}
fs.writeFileSync(
  configFile,
  config.replace(
    'export default nextConfig;',
    `nextConfig.turbopack = { ...(nextConfig.turbopack || {}), root: ${JSON.stringify(copy)} };\nnextConfig.outputFileTracingRoot = ${JSON.stringify(copy)};\nexport default nextConfig;`
  )
);

console.log('building the scratch copy...');
execFileSync('npx', ['next', 'build'], { cwd: copy, stdio: ['ignore', 'ignore', 'inherit'] });
execFileSync('node', ['scripts/copy-standalone-assets.mjs'], { cwd: copy, stdio: 'inherit' });

// --- the recorder and the server ---------------------------------------------
const events = []; // { at, auth, ev }
let open = 0;
let maxOpen = 0;
let posts = 0;
const recPort = await freePort();
const recorder = http.createServer((req, res) => {
  open++;
  maxOpen = Math.max(maxOpen, open);
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    posts++;
    const lines = body.trim().split('\n');
    for (let i = 2; i < lines.length; i += 2) {
      events.push({ auth: req.headers['x-sentry-auth'] || '', url: req.url, raw: lines[i], ev: JSON.parse(lines[i]) });
    }
    // A short delay, so overlapping sends would show as maxOpen > 1.
    setTimeout(() => {
      open--;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    }, 50);
  });
});
await new Promise((r) => recorder.listen(recPort, '127.0.0.1', r));

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const key = crypto.randomBytes(16).toString('hex');
const dataDir = path.join(work, 'data');
fs.mkdirSync(dataDir);
let log = '';
const server = spawn('node', ['server.js'], {
  cwd: path.join(copy, '.next', 'standalone'),
  env: {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_ENV: 'production',
    PORT: String(port),
    HOSTNAME: '127.0.0.1',
    DB_FILE: path.join(dataDir, 'console.db'),
    SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
    PUBLIC_BASE_URL: base,
    CRASH_REPORT_HOSTED: 'true',
    CRASH_REPORT_DSN: `http://${key}@127.0.0.1:${recPort}/2`,
    CRASH_REPORT_ENVIRONMENT: 'saas-test',
    SOURCE_COMMIT: '0123456789abcdef0123456789abcdef01234567',
  },
});
server.stdout.on('data', (d) => (log += d));
server.stderr.on('data', (d) => (log += d));

async function cleanup() {
  server.kill('SIGTERM');
  recorder.close();
  await sleep(500);
  fs.rmSync(work, { recursive: true, force: true });
}

try {
  let exited = null;
  server.on('exit', (code) => (exited = code));
  for (let i = 0; i < 80 && !/Ready|ready/.test(log) && exited === null; i++) await sleep(250);
  if (exited !== null || !/Ready|ready/.test(log)) {
    throw new Error(`the server didn't start (exit ${exited}):\n${log}`);
  }
  check(log.includes('crash reporting on (environment=saas-test, release='), 'boot line says reporting is on');
  check((log.match(/crash reporting on/g) || []).length === 1, 'one boot line: one reporter');

  const timeout = () => AbortSignal.timeout(15000);
  const get = (p, headers = {}) => fetch(base + p, { headers, redirect: 'manual', signal: timeout() });
  const post = (p, body, headers = {}) =>
    fetch(base + p, { method: 'POST', body, headers, redirect: 'manual', signal: timeout() });

  // The action ids, from the build's manifest.
  const manifest = JSON.parse(
    fs.readFileSync(path.join(copy, '.next', 'server', 'server-reference-manifest.json'), 'utf8')
  );
  const actionId = (name) =>
    Object.entries(manifest.node).find(([, v]) => v.exportedName === name || JSON.stringify(v).includes(name))?.[0];
  const rejectedId = actionId('rejectedTenantAction');
  const failingId = actionId('failingAction');
  check(!!rejectedId && !!failingId, 'found the fixture action ids');
  const action = (id) =>
    post('/crash-test/action', '[]', { 'Next-Action': id, 'Content-Type': 'text/plain;charset=UTF-8', Origin: base });

  const statuses = {};
  statuses.route = (await get('/crash-test/route-error')).status;
  statuses.render = (await get('/crash-test/render-error')).status;
  statuses.meta = (await get('/crash-test/meta-error')).status;
  statuses.r403 = (await get('/crash-test/license-403-route')).status;
  statuses.p403 = (await get('/crash-test/license-403-page')).status;
  statuses.r400 = (await get('/crash-test/license-400-route')).status;
  statuses.a403 = (await action(rejectedId)).status;
  statuses.afail = (await action(failingId)).status;
  statuses.site = (await get('/crash-test/report-site')).status;
  statuses.proxy = (await get('/crash-test/proxy-throw')).status;
  statuses.caught = (await get('/crash-test/caught')).status;
  statuses.notFound = (await get('/crash-test/not-found')).status;
  statuses.redirect = (await get('/crash-test/redirect')).status;
  // Anonymous traffic Next answers 500 itself (§3).
  statuses.multipart = (await post('/login', 'x', { 'Content-Type': 'multipart/form-data; boundary=zz' })).status;
  // A well-formed multipart body with no known action: Failed to find Server Action.
  statuses.multipartWellFormed = (
    await post('/login', '--zz\r\nContent-Disposition: form-data; name="a"\r\n\r\nb\r\n--zz--\r\n', {
      'Content-Type': 'multipart/form-data; boundary=zz',
    })
  ).status;
  // The live trigger (DEPLOYMENT.md): a real action id with a junk
  // multipart body, reported as an action error.
  statuses.liveTrigger = (
    await post('/crash-test/action', 'x', {
      'Next-Action': failingId,
      'Content-Type': 'multipart/form-data; boundary=zz',
      Origin: base,
    })
  ).status;
  // A malformed action body that V8 quotes in its SyntaxError: stored with
  // no quoted text.
  statuses.quotedBody = (
    await post('/crash-test/action', 'Ignore this: contact evil@example.com now', {
      'Next-Action': failingId,
      'Content-Type': 'text/plain;charset=UTF-8',
      Origin: base,
    })
  ).status;
  statuses.crossOrigin = (
    await post('/login', '[]', { 'Next-Action': 'abc', Origin: 'https://evil.example', 'Content-Type': 'text/plain' })
  ).status;
  statuses.routerState = (await get('/login', { RSC: '1', 'Next-Router-State-Tree': '%%%not-json' })).status;
  // A junk session cookie on a public page: nothing reported (§6.3).
  statuses.junkCookie = (await get('/login', { Cookie: 'license_console_session=garbage' })).status;
  // Process errors, which Next survives.
  statuses.rejection = (await get('/crash-test/rejection')).status;
  statuses.uncaught = (await get('/crash-test/uncaught')).status;
  await sleep(300);
  statuses.healthAfter = (await get('/api/health/db')).status;
  console.log('statuses:', JSON.stringify(statuses));

  check(statuses.route === 500 && statuses.render === 500 && statuses.afail === 500, 'route, render and action errors answer 500');
  check(statuses.proxy === 500, 'the proxy wrapper keeps the 500');
  check(statuses.healthAfter === 200, 'still serving after an unhandled rejection and an uncaught exception');
  check([statuses.multipart, statuses.crossOrigin, statuses.routerState].every((s) => s === 500), "Next answers its anonymous errors with 500");

  console.log('waiting 65 s for the 4xx counts...');
  await sleep(65000);

  const values = events.map((e) => `${e.ev.tags.source} ${e.ev.tags.route} ${e.ev.exception.values[0].type}: ${e.ev.exception.values[0].value}`);
  console.log(values.join('\n'));
  const reported = (pred) => events.filter((e) => e.ev.tags.source !== 'log4xx' && pred(e.ev));
  const value = (ev) => ev.exception.values[0].value;

  check(reported((ev) => ev.tags.route === '/crash-test/route-error' && ev.tags.route_type === 'route').length === 1, 'route error reported');
  const routeErr = reported((ev) => ev.tags.route === '/crash-test/route-error')[0];
  check(!!routeErr && value(routeErr.ev) === 'route boom for <email>', 'its email is masked');
  check(reported((ev) => ev.tags.route === '/crash-test/render-error' && ev.exception.values[0].type === 'TypeError').length === 1, 'render error reported');
  check(reported((ev) => ev.tags.route === '/crash-test/meta-error').length === 1, 'a generateMetadata error is reported');
  check(reported((ev) => value(ev) === 'action boom' && ev.tags.route_type === 'action').length === 1, 'action error reported');
  check(reported((ev) => ev.tags.route === '/crash-test/license-400-route').length === 1, 'a rethrown 400 is reported');
  check(reported((ev) => ev.tags.logmessage === 'crash test site failed' && ev.tags.source === 'log').length === 1, 'reportError site reported');
  check(reported((ev) => ev.tags.route === '/proxy' && ev.tags.route_type === 'proxy' && value(ev) === 'proxy boom').length === 1, 'proxy error reported');
  check(reported((ev) => ev.tags.source === 'process' && value(ev) === 'late rejection').length === 1, 'unhandled rejection reported');
  check(reported((ev) => ev.tags.source === 'process' && value(ev) === 'timer boom').length === 1, 'uncaught exception reported');
  check(reported((ev) => /caught boom/.test(value(ev))).length === 0, 'a caught error is not reported');
  check(reported((ev) => /crash-test\/(not-found|redirect)/.test(ev.tags.route)).length === 0, 'notFound() and redirect() are not reported');
  check(reported((ev) => ev.tags.route === '/login').length === 0, "Next's anonymous errors are not reported");
  check(reported((ev) => ev.tags.logmessage === 'session lookup failed').length === 0, 'a junk session cookie is not reported');
  const trigger = reported((ev) => value(ev) === 'Unexpected end of form');
  check(trigger.length === 1 && trigger[0].ev.tags.route_type === 'action', 'the live trigger reports an action error');
  const quoted = reported((ev) => ev.exception.values[0].type === 'SyntaxError' && ev.tags.route_type === 'action');
  check(
    quoted.length === 1 && !/Ignore|evil|example\.com|"/.test(value(quoted[0].ev)),
    'a malformed action body is stored with no quoted text'
  );
  check(reported((ev) => value(ev) === 'Unauthorized').length === 0, 'rejected-tenant 403s are not reported');

  const counts = Object.fromEntries(
    events.filter((e) => e.ev.tags.source === 'log4xx').map((e) => [e.ev.tags.route, e.ev.extra?.sample_weight || 1])
  );
  console.log('counts:', JSON.stringify(counts));
  check(counts['/crash-test/license-403-route'] === 1, 'a 403 from a route is counted (name check across bundles)');
  check(counts['/crash-test/license-403-page'] === 1, 'a 403 from a render is counted');
  check(counts['/crash-test/action'] === 1, 'a 403 from an action is counted');
  check(counts['/login'] === 4, "Next's anonymous errors are counted under /login (all four requests)");

  check(maxOpen === 1, `one send in flight at a time across bundles (saw ${maxOpen})`);
  check(events.every((e) => e.url === '/api/2/envelope/' && e.auth.includes(`sentry_key=${key}`)), 'every send carries the key');
  check(events.every((e) => e.ev.release.endsWith('+0123456')), 'release has the runtime SOURCE_COMMIT');
  const blob = events.map((e) => e.raw).join('\n');
  check(!blob.includes(copy) && !blob.includes(os.homedir()), 'no machine paths in any event');
  check(!/Failed to fetch|fetch failed|cache/i.test(log.split('\n').filter((l) => /warn|⚠/i.test(l)).join('\n')), 'no Next warning from a send');

  if (recordDir) {
    fs.mkdirSync(recordDir, { recursive: true });
    const pick = {
      'route-error': (ev) => ev.tags.route === '/crash-test/route-error',
      'render-error': (ev) => ev.tags.route === '/crash-test/render-error',
      'action-error': (ev) => value(ev) === 'action boom',
      'report-site': (ev) => ev.tags.logmessage === 'crash test site failed',
      proxy: (ev) => ev.tags.route === '/proxy',
      rejection: (ev) => value(ev) === 'late rejection',
      log4xx: (ev) => ev.tags.source === 'log4xx' && ev.tags.route === '/login',
    };
    for (const [name, pred] of Object.entries(pick)) {
      const e = events.find((x) => pred(x.ev));
      if (!e) continue;
      const header = JSON.stringify({ sent_at: e.ev.timestamp });
      fs.writeFileSync(path.join(recordDir, `console-${name}.envelope`), `${header}\n{"type":"event"}\n${e.raw}\n`);
    }
    console.log(`recorded envelopes in ${recordDir}`);
  }
} finally {
  await cleanup();
}

if (failures.length) {
  console.error(`\ncrash-reporting-e2e: ${failures.length} failed:\n- ${failures.join('\n- ')}`);
  console.error(`\nserver log:\n${log}`);
  process.exit(1);
}
console.log('\ncrash-reporting-e2e: OK');
