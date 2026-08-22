import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { getTenantApiKey, getTenantName } from '@/lib/tenant-context';
import { getAccountEmail } from '@/lib/auth';
import { listLicenses, listActivations, getBillingStatus } from '@/lib/license-client';

// Same ceiling as license-client.live.ts's own BROAD_FETCH_LIMIT - the
// backend's own GET /list-licenses max `limit`. Comfortably above either
// plan's own quota (quota.js's PLAN_LIMITS: free=5, pro=100), so one call
// covers every real tenant today; not a hard architectural ceiling (see
// the truncation warning below).
const MAX_LICENSES = 1000;

/**
 * BETA_LAUNCH_STATUS.md §4, full data export - the last item operator
 * kept as proactive rather than demand-driven (everything else left in
 * §4 - teammates, an audit log, branding self-service - is explicitly
 * deferred until a real customer asks). Until now the only way to get a
 * copy of your own license/activation data was the docs telling you to
 * manually call `GET /v1/list-licenses` and "the per-license activation
 * endpoints" yourself before deleting your account - this closes that
 * gap with one click, scoped to exactly that same data (licenses +
 * their activations + billing status), matching what the doc already
 * promised rather than expanding scope.
 *
 * A Route Handler, not a Server Action - same reasoning as every other
 * link-emailing/file-producing flow in this repo (signup, verify-email):
 * a Server Action can't set response headers or stream a file, but a
 * plain authenticated GET can just set Content-Disposition and let the
 * browser handle the download natively - no Blob/client-JS trickery
 * needed. No isSameOrigin() CSRF check (unlike this app's POST-mutating
 * Route Handlers) - this is a pure read with no state change, and a
 * cross-origin page can't read the response body of a top-level
 * navigation it tricks a user into anyway; the same posture GET
 * /api/verify-email already has for the identical reason.
 *
 * Not gated by a password re-entry step like rotate/delete - the data
 * exported here is already fully visible to any valid session via the
 * Licenses list/detail pages with no extra prompt, so adding one just
 * for the export would be an inconsistent, no-real-benefit extra step
 * rather than a genuine security boundary.
 */
export async function GET() {
  const identity = await requireSession().catch(() => null);
  if (!identity) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!identity.tenantId) {
    // Unreachable via the UI - the export section only renders under
    // MULTI_TENANT with a resolved tenant (see the Settings page).
    // Defense in depth, not a real self-hosted path - self-hosted's
    // single shared admin login has no accounts row to export.
    return NextResponse.json({ error: 'Data export is only available for hosted accounts' }, { status: 404 });
  }

  const tenantApiKey = getTenantApiKey(identity.id);
  const email = getAccountEmail(identity.id);
  const tenantName = getTenantName(identity.id);

  const [{ licenses, total }, billing] = await Promise.all([
    listLicenses({ limit: MAX_LICENSES, offset: 0 }, tenantApiKey),
    getBillingStatus(tenantApiKey),
  ]);

  // No silent truncation - if this ever fires for a real tenant (it
  // can't today, given current plan limits), the export still succeeds
  // with what fit rather than erroring, but says so loudly server-side
  // rather than quietly shipping an incomplete "full" export.
  if (total > licenses.length) {
    console.warn(
      `Data export for tenant ${identity.tenantId} truncated: ${total} licenses, only ${licenses.length} exported (MAX_LICENSES=${MAX_LICENSES}).`
    );
  }

  // One GET /list-activations/:key call per license - N+1, not a single
  // bulk call (no such endpoint exists). Accepted the same way
  // admin-report-extract.js's own aggregate query accepts its own cost:
  // cheap at today's real plan-limit scale (at most 100 licenses on the
  // pro tier), and this is a one-time, tenant-initiated click, not a
  // background job serving every tenant on a schedule - revisit if a
  // future plan tier's limit makes this slow.
  const licensesWithActivations = await Promise.all(
    licenses.map(async (license) => ({
      key: license.key,
      product_id: license.product_id,
      tier: license.tier,
      status: license.status,
      issued_to: license.issued_to,
      issued_at: license.issued_at,
      expires_at: license.expires_at,
      limits: license.limits,
      usage: license.usage,
      max_activations: license.max_activations,
      revoked_at: license.revoked_at,
      activations: await listActivations(license.key, tenantApiKey),
    }))
  );

  const exportPayload = {
    exported_at: new Date().toISOString(),
    account: {
      email,
      tenant_name: tenantName,
      tenant_id: identity.tenantId,
    },
    billing,
    licenses: licensesWithActivations,
  };

  const body = JSON.stringify(exportPayload, null, 2);
  const filename = `casazium-data-export-${new Date().toISOString().slice(0, 10)}.json`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
