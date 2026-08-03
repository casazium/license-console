import { Alert } from '@mantine/core';

export function RateLimitNotice() {
  return (
    <Alert color="yellow" title="Too many requests">
      The license server is temporarily rate-limiting requests from this console. Please wait a
      few minutes and try again.
    </Alert>
  );
}
