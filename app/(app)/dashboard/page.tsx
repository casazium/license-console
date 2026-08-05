import { Card, SimpleGrid, Text, Title } from '@mantine/core';
import {
  getDashboardStats,
  getExpiringLicenses,
  getLicensesNearSeatLimit,
  getRecentActivations,
  getRecentlyIssuedLicenses,
} from '@/lib/license-client';
import { isRateLimited } from '@/lib/errors';
import { requireSessionWithTenantKey, markIfTenantRejected } from '@/lib/tenant-context';
import { MockDataNotice } from '@/components/MockDataNotice';
import { RateLimitNotice } from '@/components/RateLimitNotice';
import { ExpiringLicensesTable } from './ExpiringLicensesTable';
import { RecentActivationsTable } from './RecentActivationsTable';
import { RecentlyIssuedLicensesTable } from './RecentlyIssuedLicensesTable';
import { SeatUtilizationTable } from './SeatUtilizationTable';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  // SaaS-B2: resolves which tenant's key (if any - undefined under
  // self-hosted) the calls below use. proxy.ts's middleware already
  // gates unauthenticated requests before this page ever renders; this
  // call's job here is tenant context, not the authorization check.
  const { identity, tenantApiKey } = await requireSessionWithTenantKey();

  // Caught here, not left to throw into Next's default Server Component
  // error boundary: a rate-limited admin bucket is a routine, expected
  // condition (this console's own server is the caller against a shared
  // per-IP limit), not a bug worth an "an error occurred" crash screen.
  // Any other error still throws unchanged - only this specific, expected
  // case gets a friendlier inline message instead of Next's default
  // handling.
  let dashboardData;
  try {
    dashboardData = await Promise.all([
      getDashboardStats(tenantApiKey),
      getRecentActivations(undefined, tenantApiKey),
      getRecentlyIssuedLicenses(undefined, tenantApiKey),
      getExpiringLicenses(undefined, undefined, tenantApiKey),
      getLicensesNearSeatLimit(undefined, tenantApiKey),
    ]);
  } catch (err) {
    if (isRateLimited(err)) {
      return (
        <>
          <Title order={2} mb="md">
            Dashboard
          </Title>
          <RateLimitNotice />
        </>
      );
    }
    // "Trigger 2" (lib/tenant-context.ts's own comment on
    // markIfTenantRejected) - a side effect, not a different response:
    // still falls through to the same `throw err` below, unchanged for
    // *this* request.
    markIfTenantRejected(err, identity.tenantId);
    throw err;
  }

  const [stats, recentActivations, recentlyIssued, expiringLicenses, seatsNearLimit] =
    dashboardData;

  return (
    <>
      <Title order={2} mb="md">
        Dashboard
      </Title>
      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        <Card withBorder padding="lg">
          <Text size="sm" c="dimmed">
            Active licenses
          </Text>
          <Title order={3}>{stats.active_licenses}</Title>
        </Card>
        <Card withBorder padding="lg">
          <Text size="sm" c="dimmed">
            Active activations
          </Text>
          <Title order={3}>{stats.active_activations}</Title>
        </Card>
        <Card withBorder padding="lg">
          <Text size="sm" c="dimmed">
            Revoked licenses
          </Text>
          <Title order={3}>{stats.revoked_licenses}</Title>
        </Card>
      </SimpleGrid>

      <Title order={4} mt="xl" mb="sm">
        Recently issued licenses
      </Title>
      <RecentlyIssuedLicensesTable licenses={recentlyIssued} />

      <Title order={4} mt="xl" mb="sm">
        Recent activations
      </Title>
      <RecentActivationsTable recentActivations={recentActivations} />

      <Title order={4} mt="xl" mb="sm">
        Expiring soon
      </Title>
      <ExpiringLicensesTable licenses={expiringLicenses} />

      <Title order={4} mt="xl" mb="sm">
        Seats near capacity
      </Title>
      <SeatUtilizationTable licenses={seatsNearLimit} />

      <MockDataNotice />
    </>
  );
}
