import { Center, Loader } from '@mantine/core';

/**
 * Route-level loading state for every page under this layout
 * (dashboard, licenses list/detail, billing, settings, onboarding) -
 * BETA_LAUNCH_STATUS.md §4's "no loading states anywhere in the
 * console" gap. Every one of these pages is an async Server Component
 * that fetches from casazium/license before rendering anything -
 * without this file, Next shows nothing at all during that fetch, so a
 * slow request or slow network reads as "did my click even register?"
 * rather than "it's working."
 *
 * One shared file, not a bespoke skeleton per page: this slots into
 * AppShellClient's <AppShell.Main> in place of {children} (the nav
 * chrome around it stays mounted and interactive, since only this
 * layout's children slot suspends), so a single centered spinner here
 * covers every route under app/(app)/ in one place.
 */
export default function Loading() {
  return (
    <Center mih="50vh">
      <Loader />
    </Center>
  );
}
