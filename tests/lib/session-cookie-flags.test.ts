import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// sessionCookieOptions (lib/session.ts) is what actually protects the
// signed session JWT in the browser - httpOnly (unreadable to any
// client-side script, the primary XSS-exfiltration defense), secure
// (never sent over plain HTTP once deployed), and sameSite: 'lax' (the
// same property CSRF-relevant code elsewhere in this repo depends on -
// isSameOrigin()'s own header comment names it as the reason
// /api/logout and /api/verify-email/resend need no separate origin
// check: "a cross-site request simply doesn't carry it"). All three
// flags were correct in source but unverified by any test - a value
// this consequential deserves a test that fails loudly if a future
// edit ever loosens it, not just a code-review read.
//
// A plain module-level constant, computed once at import time from
// process.env.NODE_ENV - not a function - so exercising both the
// production and non-production values requires a fresh module
// instance per case (vi.resetModules() + a dynamic import after the
// env stub, not a static top-of-file import).
describe('sessionCookieOptions (lib/session.ts)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is httpOnly and sameSite=lax regardless of environment', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const { sessionCookieOptions } = await import('@/lib/session');

    expect(sessionCookieOptions.httpOnly).toBe(true);
    expect(sessionCookieOptions.sameSite).toBe('lax');
    expect(sessionCookieOptions.path).toBe('/');
  });

  it('is secure in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { sessionCookieOptions } = await import('@/lib/session');

    expect(sessionCookieOptions.secure).toBe(true);
  });

  it('is not marked secure outside production (dev/test over plain HTTP)', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const { sessionCookieOptions } = await import('@/lib/session');

    expect(sessionCookieOptions.secure).toBe(false);
  });

  it('maxAge matches the session\'s real 8-hour lifetime, not left to the browser to decide', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const { sessionCookieOptions } = await import('@/lib/session');

    expect(sessionCookieOptions.maxAge).toBe(8 * 60 * 60);
  });
});
