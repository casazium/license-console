// lib/error-mask.ts
//
// faultline's masks and templater (rcasazza/faultline, internal/scrub/mask.go
// and template.go), ported from casazium/license's src/lib/error-mask.js, plus
// that repo's cleanValue and replaceQuoted (src/lib/error-reporter.js), for
// the crash reporter (lib/crash-reporter.ts, CRASH_REPORTING_DESIGN.md §8).
// faultline masks everything it receives again; masking here too means a
// secret never leaves this process.
//
// tests/fixtures/scrub-corpus.json is faultline's exported corpus and
// tests/lib/error-mask.test.ts runs every case against this file, so a
// difference from faultline fails the build. To update: regenerate it in
// faultline (`FAULTLINE_UPDATE_TESTDATA=1 go test ./internal/scrub -run
// TestCorpusExport`), copy it here, update CORPUS_COMMIT and CORPUS_SHA256 in
// the test, and change this file (and casazium/license's) until both pass.
//
// The regular expressions are Go's RE2 written for JavaScript, which
// differs in ways the corpus pins (its "about" field):
// - `\s` is only [\t\n\f\r ] in Go; JavaScript's is Unicode-wide. Written
//   out as WS below.
// - `\b` and `\w` are ASCII in both, without the `u` flag (never used here).
// - Go's (?i) also folds U+017F (ſ) into s and U+212A (Kelvin sign) into k;
//   JavaScript's `i` doesn't. Case-insensitive patterns are spelled out
//   letter by letter with fold().
// - Lower-casing for the credential word list follows Go's strings.ToLower
//   (U+0130 lowers to "i").
// - The node_modules look-back is 512 bytes of UTF-8.

const WS = '[\\t\\n\\f\\r ]';
const NOT_WS = '\\t\\n\\f\\r ';

// fold spells out Go's (?i) for a literal word.
function fold(word: string): string {
  let out = '';
  for (const c of word) {
    if (c === 's' || c === 'S') out += '[sS\\u017F]';
    else if (c === 'k' || c === 'K') out += '[kK\\u212A]';
    else if (/[a-zA-Z]/.test(c)) out += `[${c.toLowerCase()}${c.toUpperCase()}]`;
    else out += c;
  }
  return out;
}

const foldAlt = (words: string[]) => words.map((w) => fold(w)).join('|');

// mask is { re, with, keep? }: each match of re (global) becomes `with`
// ($1 refers to the first group), unless keep(match) is true.
type Mask = { re: RegExp; with: string; keep?: (match: string) => boolean };

function applyMask(s: string, m: Mask): string {
  return s.replace(m.re, (match: string, ...rest: unknown[]) => {
    if (m.keep && m.keep(match)) return match;
    const g1 = typeof rest[0] === 'string' ? rest[0] : '';
    return m.with.replace('$1', g1);
  });
}

const noDigit = (m: string) => !/[0-9]/.test(m);

// isDigits is Go's: true for an empty string too (so `password=""` is kept).
function isDigits(s: string): boolean {
  return /^[0-9]*$/.test(s);
}

// 0a. Credentials in a URL. Go: (?i)([a-z][a-z0-9+.-]*://)[^/\s@:]*:[^/\s@]+@ (no \b, so a
// digit run or underscore glued before the scheme can't hide the password)
const userinfoMask: Mask = {
  re: new RegExp(
    `([a-zA-Z\\u017F\\u212A][a-zA-Z0-9+.\\u017F\\u212A-]*://)[^/${NOT_WS}@:]*:[^/${NOT_WS}@]+@`,
    'g'
  ),
  with: '$1<userinfo>@',
};

// 0b. The value after a credential's name.
const credentialNames = foldAlt([
  'password', 'passwd', 'pass', 'pwd', 'secret', 'token',
]) + `|${fold('api')}[_-]?${fold('key')}|${fold('access')}[_-]?${fold('key')}|${fold('private')}[_-]?${fold('key')}` +
  `|${fold('session')}[_-]?${fold('id')}|${fold('credentials')}|${fold('credential')}|` + foldAlt(['authorization', 'auth', 'cookie']);
const credential = new RegExp(
  `(\\b[A-Za-z0-9_-]*(?:${credentialNames})(?:[_-]?(?:${foldAlt(['key', 'id', 'value', 'hash'])}))?\\b["']?${WS}*[:=]${WS}*` +
    `(?:(?:${foldAlt(['bearer', 'basic', 'token'])})${WS}+)?)` +
    `(?:"([^"\\n]*)"|'([^'\\n]*)'|"([^"\\n]*)(?=\\n|$)|'([^'\\n]*)(?=\\n|$)|([^${NOT_WS}"',;&]+))`,
  'g'
);

const notSecret = new Set(
  `not no none null nil undefined empty missing required invalid expired revoked
  malformed must should is was be in of for the a an set unset provided found configured signature mismatch
  too unauthorized forbidden denied failed error true false invalid_grant invalid_token expired_token
  invalid_request unsupported bad wrong cannot can't does doesn't`.split(/\s+/).filter(Boolean)
);

// goLower is Go's strings.ToLower where it differs from toLowerCase for
// the words that matter here.
function goLower(s: string): string {
  return s.replace(/\u0130/g, 'i').toLowerCase();
}

function maskCredentials(s: string): string {
  return s.replace(
    credential,
    (
      match: string,
      prefix: string,
      dq: string | undefined,
      sq: string | undefined,
      udq: string | undefined,
      usq: string | undefined,
      bare: string
    ) => {
    let value: string;
    let open = '';
    let closing = '';
    if (dq !== undefined) {
      value = dq; open = '"'; closing = '"';
    } else if (sq !== undefined) {
      value = sq; open = "'"; closing = "'";
    } else if (udq !== undefined) {
      value = udq; open = '"';
    } else if (usq !== undefined) {
      value = usq; open = "'";
    } else {
      value = bare;
    }
    const v = goLower(value);
    if (notSecret.has(v) || (isDigits(v) && v.length <= 3)) return match;
    return prefix + open + '<secret>' + closing;
    }
  );
}

const STRIPE_ID = '\\b(?:cus|evt|pi|cs|sub|in|ch|pm|price|prod|txn|si|seti|acct)_(?:test_|live_)?[A-Za-z0-9]{8,}\\b';

const masks: Mask[] = [
  // 1. Emails.
  { re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g, with: '<email>' },
  // 2. JWTs.
  { re: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, with: '<jwt>' },
  // 3. Stripe secrets, and client secrets.
  { re: /\b(?:whsec|sk_live|sk_test|rk_live|rk_test)_[A-Za-z0-9_]+/g, with: '<secret>' },
  { re: /\b(?:pi|seti)_[A-Za-z0-9]+_secret_[A-Za-z0-9]+/g, with: '<secret>' },
  // 4. Resend keys; lowercase snake_case names are left alone.
  { re: /\bre_[A-Za-z0-9_]{16,}\b/g, with: '<secret>', keep: (m) => /^[a-z]+(?:_[a-z]+)+$/.test(m) },
  // 5. License keys.
  { re: /\b[1-9A-HJ-NP-Za-km-z]{24,}-[0-9a-f]{4}\b/g, with: '<key>' },
  // 6. Tenant API keys and any long base58 word.
  { re: /\b[1-9A-HJ-NP-Za-km-z]{25,}\b/g, with: '<key>' },
  // 7. UUIDs.
  { re: /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g, with: '<uuid>' },
  // 8. Hex.
  { re: /\b[0-9a-fA-F]{32,}\b/g, with: '<hex>' },
  // 9. IPv4, then IPv6 (a match with no digit is a word, not an address).
  { re: /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g, with: '<ip>' },
  { re: /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g, with: '<ip>' },
  { re: /\b(?:[0-9a-fA-F]{1,4}:){1,6}(?::[0-9a-fA-F]{1,4}){1,6}\b/g, with: '<ip>', keep: noDigit },
  { re: /(^|[^A-Za-z0-9_:])::[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){0,6}\b/g, with: '$1<ip>', keep: noDigit },
];

// 10. Long numbers, run last; Stripe ids are left whole.
const longNumber: Mask = {
  re: new RegExp(`${STRIPE_ID}|[0-9]{6,}`, 'g'),
  with: '<n>',
  keep: (m) => !isDigits(m),
};

// 11. The generic random-token rule.
const genericToken = /[A-Za-z0-9_+/=-]{20,}/g;
const upperSnake = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;
const stripeIdPrefix = /^(?:cus|evt|pi|cs|sub|in|ch|pm|price|prod|txn|si|seti|acct)_/;
const routeLike = /^\/?(?:[a-z0-9][a-z0-9-]*\/)*[a-z0-9-]*\/?$/;
const wordSplit = /[A-Z]+[a-z]*|[a-z]+|[0-9]+/g;
const hasVowel = /[aeiouyAEIOUY]/;
const consonantRun = /[b-df-hj-np-tv-xzB-DF-HJ-NP-TV-XZ\u017F\u212A]{5}/;
const versionPart = /^(?:[A-Za-z][0-9]{1,3}|[23][dD])$/;

function utf8Length(cp: number): number {
  if (cp < 0x80) return 1;
  if (cp < 0x800) return 2;
  if (cp < 0x10000) return 3;
  return 4;
}

// inNodeModules looks back at most 512 bytes of UTF-8, as Go does.
function inNodeModules(tok: string, s: string, i: number, j: number): boolean {
  if (tok.includes('node_modules/') || s.startsWith('/node_modules', j)) return true;
  let lo = i;
  let bytes = 0;
  while (lo > 0) {
    let k = lo - 1;
    let cp = s.charCodeAt(k);
    if (cp >= 0xdc00 && cp <= 0xdfff && k > 0) {
      const hi = s.charCodeAt(k - 1);
      if (hi >= 0xd800 && hi <= 0xdbff) {
        cp = (hi - 0xd800) * 0x400 + (cp - 0xdc00) + 0x10000;
        k -= 1;
      }
    }
    const n = utf8Length(cp);
    if (bytes + n > 512) break;
    bytes += n;
    lo = k;
  }
  const window = s.slice(lo, i);
  let start = 0;
  for (let k = window.length - 1; k >= 0; k--) {
    if (' \t\n("\''.includes(window[k])) {
      start = k + 1;
      break;
    }
  }
  return window.slice(start).includes('node_modules/');
}

function entropy(s: string): number {
  const counts = new Map<string, number>();
  let n = 0;
  for (const r of s) {
    counts.set(r, (counts.get(r) || 0) + 1);
    n++;
  }
  let h = 0;
  for (const c of counts.values()) {
    const p = c / n;
    h -= p * Math.log2(p);
  }
  return h;
}

function identifierShaped(tok: string): boolean {
  if (/[+/=-]/.test(tok) || !/[_A-Z]/.test(tok)) return false;
  let words = 0;
  let letters = 0;
  let digitRuns = 0;
  for (const part of tok.split('_')) {
    if (part === '') continue;
    if (versionPart.test(part)) {
      digitRuns++;
      continue;
    }
    const ws = part.match(wordSplit) || [];
    for (let i = 0; i < ws.length; i++) {
      const w = ws[i];
      if (((w === 'V' || w === 'v') && i + 1 < ws.length && isDigits(ws[i + 1]) && ws[i + 1].length <= 2) ||
          ((w === 'D' || w === 'd') && i > 0 && (ws[i - 1] === '2' || ws[i - 1] === '3'))) {
        continue;
      }
      if (w[0] >= '0' && w[0] <= '9') {
        if (w.length > 4) return false;
        digitRuns++;
      } else if (w.length === 1) {
        return false;
      } else if (w.toUpperCase() === w) {
        if (w.length > 5) return false;
        words++;
        letters += w.length;
      } else if (!hasVowel.test(w) || consonantRun.test(w)) {
        return false;
      } else {
        words++;
        letters += w.length;
      }
    }
  }
  return words >= 2 && digitRuns <= 2 && letters >= 3 * words;
}

function keepGeneric(tokIn: string, segment: boolean): boolean {
  let tok = tokIn;
  let hasLetter = false;
  let hasDigit = false;
  let hexOnly = true;
  for (const r of tok) {
    if (r >= '0' && r <= '9') hasDigit = true;
    else if ((r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F')) hasLetter = true;
    else if ((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z')) {
      hasLetter = true;
      hexOnly = false;
    } else hexOnly = false;
  }
  const threshold = hexOnly ? 0 : 3.2;
  if (segment) tok = tok.split('-').join('_');
  if (!hasLetter || !hasDigit) return true;
  if (entropy(tok) < threshold) return true;
  if (upperSnake.test(tok)) return true;
  if (stripeIdPrefix.test(tok)) return true;
  if (identifierShaped(tok)) return true;
  return false;
}

function maskGeneric(s: string): string {
  let out = '';
  let last = 0;
  for (const m of s.matchAll(genericToken)) {
    const i = m.index ?? 0;
    const tok = m[0];
    const j = i + tok.length;
    out += s.slice(last, i);
    last = j;
    if (inNodeModules(tok, s, i, j)) {
      out += tok;
    } else if (tok.startsWith('/') || (tok.includes('/') && routeLike.test(tok))) {
      out += tok
        .split('/')
        .map((seg) => (seg.length >= 20 && !keepGeneric(seg, true) ? '<secret>' : seg))
        .join('/');
    } else if (keepGeneric(tok, false)) {
      out += tok;
    } else {
      out += '<secret>';
    }
  }
  return out + s.slice(last);
}

// mask applies faultline's masks, in faultline's order.
export function mask(input: string): string {
  let s = applyMask(input, userinfoMask);
  s = maskCredentials(s);
  for (const m of masks) s = applyMask(s, m);
  s = maskGeneric(s);
  return applyMask(s, longNumber);
}

// truncate cuts s to at most n code points, as Go's Truncate does runes.
export function truncate(s: string, n: number): string {
  const cps = Array.from(s);
  if (cps.length <= n) return s;
  return cps.slice(0, n - 1).join('') + '…';
}

// prefix returns the first n code points of s, and whether it cut.
function prefix(s: string, n: number): [string, boolean] {
  let count = 0;
  let i = 0;
  for (const c of s) {
    if (count === n) return [s.slice(0, i), true];
    count++;
    i += c.length;
  }
  return [s, false];
}

// stable repeats f until its output stops changing. faultline's masks
// aren't idempotent on every input (a late rule can create a new match),
// so the reporter sends what one more pass on faultline's side wouldn't
// change: at most a few passes, each cheap after the first cut.
export function stable(f: (s: string) => string, s: string): string {
  let prev = s;
  for (let i = 0; i < 5; i++) {
    const next = f(prev);
    if (next === prev) return next;
    prev = next;
  }
  return prev;
}

// clean is faultline's: cut to 4n back to the last whitespace, mask, and
// cut to n.
export function clean(input: string, n: number): string {
  let s = input;
  const [p, cut] = prefix(s, 4 * n);
  if (cut) {
    const i = Math.max(p.lastIndexOf(' '), p.lastIndexOf('\t'), p.lastIndexOf('\r'), p.lastIndexOf('\n'));
    s = i >= 0 ? p.slice(0, i) + ' …' : '…';
  }
  return truncate(mask(s), n);
}

const stripeAny = new RegExp(STRIPE_ID, 'g');
const quoted = /'[^'\n]*'|"[^"\n]*"|`[^`\n]*`/g;
const shortName = /^[A-Za-z_$][A-Za-z0-9_$]{0,30}$/;
const filePath = /(?:[a-z]+:\/)?(?:\/[A-Za-z0-9_.@-]+){2,}\.[A-Za-z0-9_]+/g;
const number = /(^|[^A-Za-z0-9_])[0-9]+/g;
// Go's strings.Fields splits on unicode.IsSpace.
const goSpace = /[\t\n\v\f\r \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+/;

export const MAX_TEMPLATE = 200;

// template is faultline's Template: the shape errors of one kind share.
export function template(msg: string): string {
  let s = clean(msg, 4 * MAX_TEMPLATE);
  s = s.replace(stripeAny, '<stripe-id>');
  s = s.replace(quoted, (q: string) => (shortName.test(q.slice(1, -1)) ? q : '<q>'));
  s = s.replace(filePath, (p: string) => (p.includes('node_modules') ? p : '<path>'));
  s = s.replace(number, (_m: string, pre: string) => `${pre}<n>`);
  s = s.split(goSpace).filter((f) => f !== '').join(' ');
  return truncate(s, MAX_TEMPLATE);
}

export const MAX_VALUE = 1000; // faultline keeps values up to 1,000 characters

// cleanValue (casazium/license's, CRASH_REPORTING_DESIGN.md §8): cut,
// quoted spans, Stripe ids, masks, then the final length. The result is
// already what faultline keeps, so its own masks leave it alone. In a
// SyntaxError every quoted span goes: V8 quotes the input it failed on
// (`Unexpected token 'I', "Ignore thi"... is not valid JSON`).
export function cleanValue(type: string, raw: string): string {
  let s = raw;
  const cps = Array.from(s);
  if (cps.length > 4 * MAX_VALUE) {
    const p = cps.slice(0, 4 * MAX_VALUE).join('');
    const i = Math.max(p.lastIndexOf(' '), p.lastIndexOf('\t'), p.lastIndexOf('\r'), p.lastIndexOf('\n'));
    s = i >= 0 ? p.slice(0, i) + ' …' : '…';
  }
  s = replaceQuoted(s, type === 'SyntaxError');
  s = s.replace(new RegExp(STRIPE_ID, 'g'), '<stripe-id>');
  return stable((v) => truncate(mask(v), MAX_VALUE), s);
}

// Opening quote -> closing quote. Curly and angle quotes too.
const QUOTE_PAIRS: Record<string, string> = { '"': '"', "'": "'", '`': '`', '\u2018': '\u2019', '\u201C': '\u201D', '\u00AB': '\u00BB' };
// Written as a RegExp object: a \p{} literal needs an ES2018 target.
const LETTER = new RegExp('\\p{L}', 'u');
const isLetter = (ch: string | undefined) => ch !== undefined && LETTER.test(ch);

// replaceQuoted turns quoted spans into <q>, keeping a single-quoted short
// name (faultline's shortName) unless all is set. A quote is an opening
// one only after a non-letter, and a closing one only before a non-letter,
// so apostrophes (Couldn't, Jane's, Zoë's) are neither; letters are any
// script's. A span never crosses a newline; one the cut left open runs to
// the end.
export function replaceQuoted(s: string, all: boolean): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    const close = QUOTE_PAIRS[ch];
    if (close !== undefined && !isLetter(s[i - 1])) {
      let j = i + 1;
      while (j < s.length && s[j] !== '\n' && !(s[j] === close && !isLetter(s[j + 1]))) j++;
      if (j < s.length && s[j] === close) {
        const inner = s.slice(i + 1, j);
        out += ch === "'" && !all && shortName.test(inner) ? s.slice(i, j + 1) : '<q>';
        i = j + 1;
        continue;
      }
      if (j >= s.length) {
        out += '<q>';
        break;
      }
    }
    out += ch;
    i++;
  }
  return out;
}
