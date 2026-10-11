import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, parseTimestamp } from '@/lib/format';

// License Server writes many timestamps with SQLite's CURRENT_TIMESTAMP:
// "YYYY-MM-DD HH:MM:SS", UTC with no zone marker. In a browser west of
// UTC they showed shifted by the viewer's offset (live test, 2026-10-11:
// a delivery processed at 12:20 UTC showed as 16:20 UTC in EDT). Run in a
// non-UTC zone, as a viewer's browser would be - Node reads process.env.TZ
// at each Date call.
describe('lib/format: server timestamps read as UTC', () => {
  let tz: string | undefined;
  beforeEach(() => {
    tz = process.env.TZ;
    process.env.TZ = 'America/New_York';
  });
  afterEach(() => {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  });

  it('the zone really is local in this test (so the cases below would fail on the old code)', () => {
    expect(new Date('2026-10-11T12:20:13').getTime()).not.toBe(Date.UTC(2026, 9, 11, 12, 20, 13));
  });

  it("formatDateTime shows a SQLite timestamp at its own UTC time", () => {
    expect(formatDateTime('2026-10-11 12:20:13')).toBe('2026-10-11 12:20:13 UTC');
  });

  it('formatDate keeps a SQLite timestamp late in the UTC day on its own date', () => {
    expect(formatDate('2026-10-11 23:30:00')).toBe('2026-10-11');
  });

  it('parseTimestamp reads the SQLite shape, with fractional seconds too, as UTC', () => {
    expect(parseTimestamp('2026-10-11 12:20:13')).toBe(Date.UTC(2026, 9, 11, 12, 20, 13));
    expect(parseTimestamp('2026-10-11 12:20:13.500')).toBe(Date.UTC(2026, 9, 11, 12, 20, 13, 500));
  });

  it('leaves ISO timestamps that carry a zone as they are', () => {
    expect(formatDateTime('2026-10-11T12:20:13.000Z')).toBe('2026-10-11 12:20:13 UTC');
    expect(formatDateTime('2026-10-11T08:20:13-04:00')).toBe('2026-10-11 12:20:13 UTC');
    expect(formatDate('2027-02-18T12:18:31.000Z')).toBe('2027-02-18');
  });

  it("still shows a null as 'Never'", () => {
    expect(formatDateTime(null)).toBe('Never');
    expect(formatDate(null)).toBe('Never');
  });
});
