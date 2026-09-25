import { describe, expect, it } from 'vitest';
import { MIN_COMPATIBLE_SERVER_VERSION, isServerVersionCompatible } from '@/lib/version';

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
