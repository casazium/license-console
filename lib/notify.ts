import { notifications } from '@mantine/notifications';

// Shared so every action that can hit the admin rate limit (issue, revoke,
// delete, reissue token) shows the same message rather than each call
// site wording it slightly differently.
export function notifyRateLimited() {
  notifications.show({
    color: 'yellow',
    title: 'Too many requests',
    message: 'Please wait a few minutes and try again.',
  });
}

// SaaS-B4. Only issueLicenseAction can actually produce these (quota.js's
// check is on POST /issue-license alone) - the other write actions never
// call these, not dead code left over from a broader design.
export function notifyOverQuota() {
  notifications.show({
    color: 'red',
    title: 'License quota reached',
    message: "You've reached your plan's license limit. Upgrade your plan to issue more.",
  });
}

export function notifyPaymentFailed() {
  notifications.show({
    color: 'red',
    title: 'Subscription inactive',
    message: 'Your subscription is not active. Update your billing to issue new licenses.',
  });
}

// Beta-readiness finding: product_id is bound to whichever tenant claims
// it first (casazium/license's per-tenant ownership check) - a collision
// here can never be fixed by retrying the same input, so this needs its
// own message pointing at the actual fix (pick a different product_id)
// rather than issueLicenseAction's generic catch-all.
export function notifyProductIdTaken() {
  notifications.show({
    color: 'red',
    title: 'Product ID already in use',
    message: 'That product ID is already registered to a different account. Pick a different one for this license.',
  });
}

// Round-3 independent review, console finding C-1: registerReleaseAction
// previously fell through to a generic "Failed to register release"
// message for both of these - reusing notifyPaymentFailed() above would
// be inaccurate here (its wording says "issue new licenses," not
// releases).
export function notifyReleasePaymentFailed() {
  notifications.show({
    color: 'red',
    title: 'Subscription inactive',
    message: 'Your subscription is not active. Update your billing to register new releases.',
  });
}

export function notifyReservedProductId() {
  notifications.show({
    color: 'red',
    title: 'Reserved product ID',
    message: 'That product ID uses a reserved prefix and cannot be used. Pick a different one.',
  });
}

// Round-5 independent review, finding F5-6: registerReleaseAction fell
// through to a generic "Something went wrong" for artifact_url/
// release_notes rejections, a duplicate registration, and a bucket
// hitting its release cap - none of these are transient, so a generic
// "please try again" message is actively misleading (retrying the exact
// same input either can never succeed, or needs a different action
// first).
export function notifyInvalidArtifactUrl() {
  notifications.show({
    color: 'red',
    title: 'Invalid artifact URL',
    message: 'artifact_url must be a valid http:// or https:// URL.',
  });
}

export function notifyReleaseNotesTooLong() {
  notifications.show({
    color: 'red',
    title: 'Release notes too long',
    message: 'Release notes can be at most 10,000 characters.',
  });
}

export function notifyDuplicateRelease() {
  notifications.show({
    color: 'red',
    title: 'Release already exists',
    message:
      'A published release already exists for this product ID, version, channel, and platform. Unpublish it first if you need to replace it.',
  });
}

export function notifyReleaseLimitReached() {
  notifications.show({
    color: 'red',
    title: 'Release limit reached',
    message:
      'This product/channel/platform has reached its release limit. Unpublish an old release before registering a new one.',
  });
}
