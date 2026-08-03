// Common US time zones for the "Issue license" form's expiration time
// zone picker - not an exhaustive IANA list, just the realistic range for
// a US-run license console. Eastern is first/default per operator
// preference.
export const US_TIMEZONE_OPTIONS = [
  { value: 'America/New_York', label: 'Eastern (ET)' },
  { value: 'America/Chicago', label: 'Central (CT)' },
  { value: 'America/Denver', label: 'Mountain (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific (PT)' },
  { value: 'UTC', label: 'UTC' },
];

/**
 * Converts a wall-clock date + time meant to represent local time in
 * `timeZone` into a UTC ISO 8601 string. Standard two-pass Intl technique:
 * treat the wall-clock numbers as a UTC guess, see what that guess reads
 * as when formatted in `timeZone` to recover that zone's current offset,
 * then apply the offset in reverse. Correctly accounts for DST on the
 * given date (e.g. EST vs EDT) using the runtime's own IANA database via
 * Intl - no timezone-data dependency needed.
 */
export function zonedDateTimeToIso(dateStr: string, timeStr: string, timeZone: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);

  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(utcGuess).map((p) => [p.type, p.value]));

  const guessReadInZoneAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) === 24 ? 0 : Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );

  const offsetMs = guessReadInZoneAsUtc - utcGuess.getTime();
  return new Date(utcGuess.getTime() - offsetMs).toISOString();
}
