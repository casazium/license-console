#!/usr/bin/env node
// scripts/check-report-error.mjs
//
// Keeps every caught server error reported (CRASH_REPORTING_DESIGN.md §6.1,
// §13). Run in CI; exits 1 with a list of file:line on any violation.
//
// 1. Every console.error in a server file (under app/ and lib/, plus
//    instrumentation.ts and proxy.ts; 'use client' files are browser code
//    and skipped) is followed, as the next statement in its block, by a
//    reportError(...) call - unless a `// report-error-ok: <reason>` comment
//    is on its line or the one above.
// 2. reportError's label (2nd argument) and route (3rd, when given) are
//    string literals: a label or route is never data.
//    console.error is only ever called directly - not as console['error'],
//    and not through an alias (const log = console.error) - and
//    reportError is imported under its own name, so the check above sees
//    every call.
// 3. No `instanceof` against an app class in lib/crash-reporter.ts or
//    instrumentation.ts: Turbopack gives each bundle its own copy of a
//    class, so the check is false across bundles (§3). Built-in classes are
//    fine.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILTINS = new Set([
  'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'EvalError', 'URIError', 'AggregateError',
  'Array', 'Object', 'Map', 'Set', 'Date', 'RegExp', 'Promise', 'Uint8Array', 'URL', 'Response', 'Request', 'Headers',
]);
const NO_INSTANCEOF = new Set(['lib/crash-reporter.ts', 'instrumentation.ts']);

function files(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...files(p));
    else if (/\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

const targets = [
  ...files(path.join(root, 'app')),
  ...files(path.join(root, 'lib')),
  path.join(root, 'instrumentation.ts'),
  path.join(root, 'proxy.ts'),
];

const isLiteral = (n) => n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n));
const isConsoleError = (n) =>
  ts.isCallExpression(n) &&
  ts.isPropertyAccessExpression(n.expression) &&
  ts.isIdentifier(n.expression.expression) &&
  n.expression.expression.text === 'console' &&
  n.expression.name.text === 'error';
const isReportErrorCall = (n) =>
  ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'reportError';

const problems = [];
for (const file of targets) {
  const rel = path.relative(root, file);
  const src = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const first = sf.statements[0];
  if (
    first &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === 'use client'
  ) {
    continue;
  }
  const lines = src.split('\n');
  const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const okNear = (line) => `${lines[line - 2] || ''}\n${lines[line - 1] || ''}`.includes('report-error-ok:');

  const visit = (n) => {
    if (isConsoleError(n)) {
      const line = lineOf(n);
      const stmt = n.parent;
      let ok = okNear(line);
      if (!ok && stmt && ts.isExpressionStatement(stmt) && stmt.parent && 'statements' in stmt.parent) {
        const siblings = stmt.parent.statements;
        const next = siblings[siblings.indexOf(stmt) + 1];
        ok = !!next && ts.isExpressionStatement(next) && isReportErrorCall(next.expression);
      }
      if (!ok) {
        problems.push(`${rel}:${line}: console.error isn't followed by reportError(); add one, or "// report-error-ok: <reason>"`);
      }
    }
    // console.error used any other way than a direct call: an alias or
    // console['error'] would escape rule 1.
    const isConsoleErrorRef =
      (ts.isPropertyAccessExpression(n) &&
        ts.isIdentifier(n.expression) &&
        n.expression.text === 'console' &&
        n.name.text === 'error') ||
      (ts.isElementAccessExpression(n) &&
        ts.isIdentifier(n.expression) &&
        n.expression.text === 'console' &&
        isLiteral(n.argumentExpression) &&
        n.argumentExpression.text === 'error');
    if (isConsoleErrorRef && !(ts.isCallExpression(n.parent) && n.parent.expression === n && ts.isPropertyAccessExpression(n))) {
      problems.push(`${rel}:${lineOf(n)}: call console.error directly (no alias, no console['error']) so this check can see it`);
    }
    if (
      ts.isImportSpecifier(n) &&
      (n.propertyName ? n.propertyName.text : n.name.text) === 'reportError' &&
      n.name.text !== 'reportError'
    ) {
      problems.push(`${rel}:${lineOf(n)}: import reportError under its own name so this check can see it`);
    }
    if (isReportErrorCall(n)) {
      const [, label, route] = n.arguments;
      if (!isLiteral(label)) problems.push(`${rel}:${lineOf(n)}: reportError's label must be a string literal`);
      if (route !== undefined && !isLiteral(route)) {
        problems.push(`${rel}:${lineOf(n)}: reportError's route must be a string literal`);
      }
    }
    if (
      NO_INSTANCEOF.has(rel) &&
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword &&
      !(ts.isIdentifier(n.right) && BUILTINS.has(n.right.text))
    ) {
      problems.push(`${rel}:${lineOf(n)}: no instanceof against an app class here (each bundle has its own copy)`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

if (problems.length) {
  console.error(`check-report-error: ${problems.length} problem(s)\n${problems.join('\n')}`);
  process.exit(1);
}
console.log('check-report-error: OK');
