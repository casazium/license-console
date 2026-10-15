import { afterEach, describe, expect, it } from 'vitest';
import { MIN_COMPATIBLE_SERVER_VERSION, getAppVersion, isServerVersionCompatible } from '@/lib/version';

describe('isServerVersionCompatible', () => {
  it('returns true for a version newer than the minimum', () => {
    expect(isServerVersionCompatible('1.6.0')).toBe(true);
  });

  it('returns true for a version exactly equal to the minimum', () => {
    expect(isServerVersionCompatible(MIN_COMPATIBLE_SERVER_VERSION)).toBe(true);
  });

  it('returns false for a version older than the minimum', () => {
    expect(isServerVersionCompatible('1.4.0')).toBe(false);
  });

  it('returns false for an older patch version within the same minor', () => {
    expect(isServerVersionCompatible('1.5.2')).toBe(false);
  });

  it('returns null, not false, for an unparseable version', () => {
    expect(isServerVersionCompatible('unknown')).toBeNull();
  });

  it('returns null for a version with the wrong number of segments', () => {
    expect(isServerVersionCompatible('1.5')).toBeNull();
    expect(isServerVersionCompatible('1.5.3.1')).toBeNull();
  });
});

describe('getAppVersion gitSha', () => {
  const saved = { SOURCE_COMMIT: process.env.SOURCE_COMMIT, GIT_SHA: process.env.GIT_SHA };
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("prefers SOURCE_COMMIT, read at request time (GIT_SHA is 'unknown' in the image)", () => {
    process.env.GIT_SHA = 'unknown';
    process.env.SOURCE_COMMIT = '26d1bfe0123456789abcdef0123456789abcdef0';
    expect(getAppVersion().gitSha).toBe('26d1bfe');
  });

  it('falls back to GIT_SHA when SOURCE_COMMIT is missing or malformed', () => {
    process.env.GIT_SHA = 'abc1234';
    delete process.env.SOURCE_COMMIT;
    expect(getAppVersion().gitSha).toBe('abc1234');
    process.env.SOURCE_COMMIT = 'main';
    expect(getAppVersion().gitSha).toBe('abc1234');
  });
});
