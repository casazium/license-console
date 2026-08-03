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
export function formatDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toISOString().slice(0, 19).replace('T', ' ');
}
