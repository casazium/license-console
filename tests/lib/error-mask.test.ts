// lib/error-mask.ts is a port of faultline's masks and templater, plus
// casazium/license's cleanValue. This runs faultline's own exported corpus
// against it, so any difference from faultline fails here
// (CRASH_REPORTING_DESIGN.md §8).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { clean, cleanValue, mask, replaceQuoted, template } from '@/lib/error-mask';

// The faultline commit tests/fixtures/scrub-corpus.json was copied from
// (rcasazza/faultline testdata/scrub-corpus.json), and the file's hash: a
// changed copy must come with a new commit and a new hash, deliberately.
const CORPUS_COMMIT = 'd8f9aa8';
const CORPUS_SHA256 = 'd202ef82bac4bf531333f92abfe025d93366152647ef34f108c41dc8d55de1dd';

const corpusPath = path.join(__dirname, '..', 'fixtures', 'scrub-corpus.json');
const corpusBytes = fs.readFileSync(corpusPath);
const corpus = JSON.parse(corpusBytes.toString('utf8')) as {
  mask: { kind: string; in: string; want: string }[];
};

describe(`faultline's masking corpus (faultline ${CORPUS_COMMIT})`, () => {
  it('is the copy recorded here', () => {
    expect(crypto.createHash('sha256').update(corpusBytes).digest('hex')).toBe(CORPUS_SHA256);
  });

  it('has the cases it should', () => {
    expect(corpus.mask.length).toBe(787);
    const kinds = new Set(corpus.mask.map((c) => c.kind));
    for (const k of ['positive', 'negative', 'generated-license-key', 'generated-tenant-key', 'generated-hex-token']) {
      expect(kinds.has(k)).toBe(true);
    }
  });

  it('masks every case exactly as faultline does', () => {
    const wrong = corpus.mask
      .map((c) => ({ ...c, got: mask(c.in) }))
      .filter((c) => c.got !== c.want)
      .map((c) => `${c.kind}: ${JSON.stringify(c.in)} -> ${JSON.stringify(c.got)}, want ${JSON.stringify(c.want)}`);
    expect(wrong).toEqual([]);
  });

  it('changes nothing when masking its own output', () => {
    for (const c of corpus.mask) expect(mask(c.want)).toBe(c.want);
  });
});

describe('template (faultline Template)', () => {
  // The same outputs casazium/license checks against faultline's Go Template.
  it.each([
    ['license 4f2a9c1e7b3d4e5f6a7b8c9d0e1f2a3b not found', 'license <hex> not found'],
    ['Expected 3 rows, got 12', 'Expected <n> rows, got <n>'],
    ["Cannot read properties of undefined (reading 'tier')", "Cannot read properties of undefined (reading 'tier')"],
    ["ENOENT: no such file or directory, open '/app/data/x.json'", 'ENOENT: no such file or directory, open <q>'],
    ['failed at /app/src/routes/issue-license.js', 'failed at <path>'],
    ['no customer cus_NffrFeUfNV2Hib', 'no customer <stripe-id>'],
    ['Timeout after 30000ms', 'Timeout after <n>ms'],
    ["Couldn't load tenant's key", "Couldn<q>s key"],
    ['HTTP_503', 'HTTP_503'],
    ['a b c  d\te', 'a b c d e'],
  ])('%s', (input, want) => {
    expect(template(input)).toBe(want);
    expect(template(template(input))).toBe(want);
  });
});

describe('cleanValue (casazium/license)', () => {
  it('removes the request body V8 quotes in a JSON SyntaxError', () => {
    // Measured in the built Console: a malformed server-action body.
    const got = cleanValue('SyntaxError', `Unexpected token 'I', "Ignore thi"... is not valid JSON`);
    expect(got).toBe('Unexpected token <q>, <q>... is not valid JSON');
  });

  it('keeps a short single-quoted name outside a SyntaxError', () => {
    expect(cleanValue('TypeError', "Cannot read properties of undefined (reading 'tier')")).toBe(
      "Cannot read properties of undefined (reading 'tier')"
    );
  });

  it('removes a quoted remote response body', () => {
    const got = cleanValue('Error', 'Resend API responded with 422: {"message":"The to field must be jane@example.com"}');
    expect(got).not.toContain('jane');
    expect(got).not.toContain('example.com');
  });

  it('handles curly and angle quotes, and leaves apostrophes alone', () => {
    expect(replaceQuoted('name “Jane Doe” and «x y»', false)).toBe('name <q> and <q>');
    expect(replaceQuoted("Couldn't reach the server", false)).toBe("Couldn't reach the server");
  });

  it('replaces Stripe ids', () => {
    expect(cleanValue('Error', 'No such customer: cus_NffrFeUfNV2Hib')).toBe('No such customer: <stripe-id>');
  });

  it('masks emails and UUIDs (account and tenant ids)', () => {
    const got = cleanValue('Error', 'account 6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b (jane@example.com) not found');
    expect(got).toBe('account <uuid> (<email>) not found');
  });

  it('cuts very long text and stays within faultline’s 1,000 characters', () => {
    const got = cleanValue('Error', 'word '.repeat(5000));
    expect(Array.from(got).length).toBeLessThanOrEqual(1000);
  });
});

describe('clean (faultline clean)', () => {
  it('cuts long text before masking, back to whitespace', () => {
    const got = clean('word '.repeat(2000) + 'tail', 120);
    expect(Array.from(got).length).toBeLessThanOrEqual(120);
    expect(got.endsWith('…')).toBe(true);
  });

  it('is cheap on a megabyte of the email rule’s worst case', () => {
    const s = 'a'.repeat(1 << 20) + '@';
    const start = performance.now();
    clean(s, 1000);
    expect(performance.now() - start).toBeLessThan(500);
  });
});
