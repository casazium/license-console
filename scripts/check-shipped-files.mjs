#!/usr/bin/env node
// scripts/check-shipped-files.mjs
//
// The built Console must not name faultline or carry a DSN
// (CRASH_REPORTING_DESIGN.md §9): the DSN is a per-resource secret, set in
// Coolify, never built in. Run in CI after `npm run build`; exits 1 on a
// match. Scans what ships - .next/standalone and .next/static - and skips
// source maps, whose embedded sources carry comments that may name
// faultline.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dirs = [path.join(root, '.next', 'standalone'), path.join(root, '.next', 'static')];
const HOST = /faultline\.casazium\.com/i;
const DSN = /https?:\/\/[0-9a-f]{32}@[A-Za-z0-9.-]+(?::[0-9]+)?\/[0-9]+/i;
// Everything is scanned but source maps and binary assets.
const SKIP = /\.(map|node|png|jpe?g|gif|webp|ico|woff2?|ttf|otf|eot|wasm|gz|br|zip)$/i;

for (const d of dirs) {
  if (!fs.existsSync(d)) {
    console.error(`check-shipped-files: ${path.relative(root, d)} is missing; run npm run build first`);
    process.exit(1);
  }
}

const problems = [];
let scanned = 0;
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.isFile() && !SKIP.test(e.name)) {
      const s = fs.readFileSync(p, 'utf8');
      scanned++;
      if (HOST.test(s)) problems.push(`${path.relative(root, p)}: names faultline's host`);
      if (DSN.test(s)) problems.push(`${path.relative(root, p)}: carries a DSN`);
    }
  }
}
for (const d of dirs) walk(d);

if (problems.length) {
  console.error(`check-shipped-files: ${problems.length} problem(s)\n${problems.join('\n')}`);
  process.exit(1);
}
console.log(`check-shipped-files: OK (${scanned} files)`);
