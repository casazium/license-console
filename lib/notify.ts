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
