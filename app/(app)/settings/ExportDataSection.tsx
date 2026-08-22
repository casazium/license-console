import { Box, Button, Text, Title } from '@mantine/core';

/**
 * BETA_LAUNCH_STATUS.md §4, full data export - see app/api/export-data/route.ts's
 * own header comment for the full design record.
 *
 * A plain Server Component, not a client one - unlike every other
 * section on this page, there's no state or confirmation step here
 * (this is a read with no consequence, see the route's own comment on
 * why it isn't password-gated), so a plain anchor pointed at the Route
 * Handler is enough; the browser handles the download natively via that
 * route's Content-Disposition header, no client JS required.
 */
export function ExportDataSection() {
  return (
    <Box mt="xl" pt="lg" style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
      <Title order={3}>Export your data</Title>
      <Text size="sm" c="dimmed" mt={4} mb="md">
        Download a copy of every license and activation your account owns, plus your current
        billing status - useful before deleting your account, or just to keep your own record.
      </Text>
      <Button component="a" href="/api/export-data" variant="outline">
        Download my data
      </Button>
    </Box>
  );
}
