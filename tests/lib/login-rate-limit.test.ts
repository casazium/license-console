import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkAndReserveAttempt, getAccountOnlyKey, getClientKey, refundAttempt } from '@/lib/login-rate-limit';

// Each test uses its own unique key (the module keeps one process-wide
// Map) so tests never interfere with each other's bucket state.
let counter = 0;
function uniqueKey(label: string): string {
  counter += 1;
  return `${label}-${counter}-${Date.now()}`;
}

describe('checkAndReserveAttempt (lib/login-rate-limit.ts)', () => {
  it('allows up to maxAttempts, then blocks', () => {
    const key = uniqueKey('allow-then-block');
    for (let i = 0; i < 5; i += 1) {
      expect(checkAndReserveAttempt(key)).toEqual({ allowed: true });
    }
    const result = checkAndReserveAttempt(key);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
    }
  });

  it('respects a custom maxAttempts override', () => {
    const key = uniqueKey('custom-max');
    expect(checkAndReserveAttempt(key, 2)).toEqual({ allowed: true });
    expect(checkAndReserveAttempt(key, 2)).toEqual({ allowed: true });
    expect(checkAndReserveAttempt(key, 2).allowed).toBe(false);
  });

  it('refundAttempt frees up one reservation for a later call', () => {
    const key = uniqueKey('refund');
    for (let i = 0; i < 2; i += 1) {
      checkAndReserveAttempt(key, 2);
    }
    expect(checkAndReserveAttempt(key, 2).allowed).toBe(false);
    refundAttempt(key);
    expect(checkAndReserveAttempt(key, 2).allowed).toBe(true);
  });

  it('refundAttempt on an unknown key is a harmless no-op', () => {
    expect(() => refundAttempt(uniqueKey('never-reserved'))).not.toThrow();
  });
});

describe('getClientKey (lib/login-rate-limit.ts)', () => {
  // beforeEach added (round-3 independent review, test-hygiene finding
  // T-3): the afterEach alone left the first test in this block running
  // against whatever TRUSTED_PROXY_COUNT happened to be set in the
  // ambient environment, rather than this suite's own known-clean state.
  beforeEach(() => {
    delete process.env.TRUSTED_PROXY_COUNT;
  });

  afterEach(() => {
    delete process.env.TRUSTED_PROXY_COUNT;
  });

  it('falls back to a fixed "direct" IP when there is no X-Forwarded-For', () => {
    const request = new Request('https://console.example.com/api/login');
    expect(getClientKey(request)).toBe('direct');
  });

  it('reads the rightmost X-Forwarded-For hop (the trusted proxy-appended one)', () => {
    const request = new Request('https://console.example.com/api/login', {
      headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.5' },
    });
    expect(getClientKey(request)).toBe('10.0.0.5');
  });

  it('hashes identifier+ip together, and normalizes the identifier first', () => {
    const request = new Request('https://console.example.com/api/login', {
      headers: { 'x-forwarded-for': '10.0.0.5' },
    });
    const a = getClientKey(request, ' Alice@Example.com ');
    const b = getClientKey(request, 'alice@example.com');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}\|10\.0\.0\.5$/);
  });
});

describe('getAccountOnlyKey (lib/login-rate-limit.ts)', () => {
  it('normalizes case/whitespace to the same key', () => {
    expect(getAccountOnlyKey(' Bob@Corp.com ')).toBe(getAccountOnlyKey('bob@corp.com'));
  });

  it('produces different keys for different accounts', () => {
    expect(getAccountOnlyKey('alice@example.com')).not.toBe(getAccountOnlyKey('bob@example.com'));
  });
});
