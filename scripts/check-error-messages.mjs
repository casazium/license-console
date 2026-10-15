#!/usr/bin/env node
// scripts/check-error-messages.mjs
//
// No data in error messages (CRASH_REPORTING_DESIGN.md §8): error messages
// are reported, so one built from a value could carry an email, an id or a
// remote response out of the process. Ported from casazium/license's
// scripts/check-error-messages.mjs (its check 2), walking the TypeScript AST
// instead of acorn's. Run in CI; exits 1 with a list of file:line.
//
// An error constructed with a message that isn't fixed text - a template
// with a value, a concatenation with a value, a variable, another error's
// message, a call; `super(...)` and AggregateError's message too - or an
// error whose `.message` is set to such text, needs a
// `// error-message-ok: <reason>` comment on that line or the one above (a
// status code, a setting's name, a count, the License Server's own text for
// the user are fine; a response body or a payload is not).
//
// Scope: server code under app/ and lib/, plus instrumentation.ts and
// proxy.ts. Skipped: 'use client' files (browser code, never reported);
// lib/license-client.mock.ts (standalone and demo installs only, which
// never report, and its messages are shown to that install's own user);
// lib/secret-files.ts (boot-only: it runs before reporting starts, as 1a
// skips its BOOT_ONLY_FILES).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXCLUDED = new Set(['lib/license-client.mock.ts', 'lib/secret-files.ts']);
const ERROR_NAME = /^(?:[A-Z]\w*)?Error$/;

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

const isFixed = (n) => ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n);

// interpolates reports whether a message puts a value into its text.
function interpolates(n) {
  while (ts.isParenthesizedExpression(n)) n = n.expression;
  if (isFixed(n)) return false;
  if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const leaves = (x) =>
      ts.isBinaryExpression(x) && x.operatorToken.kind === ts.SyntaxKind.PlusToken
        ? [...leaves(x.left), ...leaves(x.right)]
        : [x];
    return !leaves(n).every(isFixed);
  }
  return true;
}

// calleeName is the constructor's name: Error, errors.HttpError -> HttpError.
function calleeName(expr) {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  return null;
}

const problems = [];
for (const file of targets) {
  const rel = path.relative(root, file);
  if (EXCLUDED.has(rel)) continue;
  const src = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const first = sf.statements[0];
  if (first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === 'use client') {
    continue;
  }
  const lines = src.split('\n');
  const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  // The escape needs a reason after the colon.
  const okNear = (line) => [lines[line - 2], lines[line - 1]].some((l) => /error-message-ok:[ \t]*\S/.test(l || ''));

  const visit = (n) => {
    const isNew = ts.isNewExpression(n);
    const isCall = ts.isCallExpression(n);
    if (isNew || isCall) {
      const superCall = isCall && n.expression.kind === ts.SyntaxKind.SuperKeyword;
      const name = superCall ? 'super' : calleeName(n.expression);
      if (superCall || (name && ERROR_NAME.test(name))) {
        const args = n.arguments || [];
        const msg = name === 'AggregateError' ? args[1] : args[0];
        if (msg && !ts.isSpreadElement(msg) && interpolates(msg) && !okNear(lineOf(n))) {
          problems.push(
            `${rel}:${lineOf(n)}: ${name} message isn't fixed text; add "// error-message-ok: <reason>" if it can't carry data`
          );
        }
      }
    }
    const assignsMessage =
      ts.isBinaryExpression(n) &&
      ts.isPropertyAccessExpression(n.left) &&
      n.left.name.text === 'message' &&
      ((n.operatorToken.kind === ts.SyntaxKind.EqualsToken && interpolates(n.right)) ||
        n.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken);
    if (assignsMessage && !okNear(lineOf(n))) {
      problems.push(`${rel}:${lineOf(n)}: an error's .message is set to non-fixed text; add "// error-message-ok: <reason>"`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

if (problems.length) {
  console.error(`check-error-messages: ${problems.length} problem(s)\n${problems.join('\n')}`);
  process.exit(1);
}
console.log('check-error-messages: OK');
