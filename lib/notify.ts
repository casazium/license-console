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
