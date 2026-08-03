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
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { timeZone: 'UTC' });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { timeZone: 'UTC' });
}
