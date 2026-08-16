// Fixed locale + UTC, not the runtime default, for every date/time shown
// anywhere in the app - two distinct reasons this matters, not just one:
//
// 1. Hydration safety: 'use client' components render once server-side
//    (SSR, using the container's runtime locale/timezone) and again
//    client-side during hydration (using the browser's). Left to their
//    defaults, those two commonly disagree - confirmed in production as a
//    real React #418 hydration-mismatch crash that unmounted a table's
//    sibling content (the "Issue license" button).
// 2. Cross-page consistency: even where hydration isn't a risk (a Server
//    Component that only ever renders once), an unpinned formatter still
//    means the *same instant* displays differently on different pages
//    depending on what locale/timezone happened to apply where - confirmed
//    directly: the same activation showed 4 hours apart on the dashboard
//    vs. the license detail page, because only some call sites were pinned
//    and others used the runtime default.
//
// Every date/time display in the app should go through one of these two
// functions rather than calling toLocaleDateString()/toLocaleString()
// directly, so both properties hold everywhere, not just at whichever
// call sites happened to get fixed first.
//
// YYYY-MM-DD (and YYYY-MM-DD HH:mm:ss for the time variant), not a
// locale-formatted string: matches the "Issue license" form's DateInput
// (valueFormat="YYYY-MM-DD"), unambiguous regardless of the reader's own
// locale, and sorts correctly as plain text. Built from toISOString()
// rather than Intl.DateTimeFormat options - toISOString() is always UTC
// and always zero-padded, so no locale/timeZone options are needed here.
//
// null accepted, not just string (independent-review finding surfaced
// while building the license-terms edit route): expires_at has been
// nullable on the backend for a while (null = perpetual license), and
// both functions used to construct new Date(null) unconditionally -
// which is the Unix epoch, not "never" - silently rendering a perpetual
// license's expiry as 1970-01-01 rather than a caller ever having a
// chance to special-case it.
export function formatDate(iso: string | null): string {
  return iso === null ? 'Never' : new Date(iso).toISOString().slice(0, 10);
}

// "UTC" suffix, not left implicit: operator-reported gap - a bare
// timestamp like "2026-08-03 05:06:11" doesn't say what zone it's in,
// which reads as the viewer's own local time by default (it isn't - it's
// always UTC, see the module doc above). This is a stopgap, not the real
// fix - the real fix is a per-admin timezone preference (a profile
// settings page, not built yet), so every admin sees times in their own
// zone instead of having to mentally convert from UTC. Until then, at
// least label what zone is actually shown so it isn't ambiguous.
export function formatDateTime(iso: string | null): string {
  return iso === null ? 'Never' : `${new Date(iso).toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}
