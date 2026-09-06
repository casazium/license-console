import { describe, expect, it } from 'vitest';

import { config } from '@/proxy';

// Guards the matcher's exclusion list, which is easy to break by editing
// the regex and easy to miss: nothing else fails when robots.txt starts
// matching again. It just silently 307s to /login, and the only symptom
// is a search engine quietly receiving no crawl directives - which is
// exactly how the original bug went unnoticed on both live instances.
//
// Asserted against the real exported matcher rather than a copy, so a
// change to proxy.ts's regex is what this test actually sees.
const [pattern] = config.matcher;
const matches = (pathname: string) => new RegExp(`^${pattern}$`).test(pathname);

describe('proxy matcher', () => {
  it.each(['/robots.txt', '/favicon.ico', '/_next/static/chunk.js', '/_next/image'])(
    'does not run for the static asset %s',
    (pathname) => {
      expect(matches(pathname)).toBe(false);
    },
  );

  it.each(['/', '/dashboard', '/licenses', '/licenses/new', '/settings', '/api/licenses'])(
    'still runs for %s so its session check is not bypassed',
    (pathname) => {
      expect(matches(pathname)).toBe(true);
    },
  );

  it('still runs for the public pages, which self-gate via PUBLIC_PATHS', () => {
    // These are exempted inside proxy() itself, not by the matcher - the
    // distinction matters, because the matcher is a blunt "never run"
    // and PUBLIC_PATHS is "run, then decide".
    expect(matches('/login')).toBe(true);
    expect(matches('/signup')).toBe(true);
  });
});
