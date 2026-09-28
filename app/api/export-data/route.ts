import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { getTenantApiKey, getTenantName, markIfTenantRejected } from '@/lib/tenant-context';
import { getAccountEmail } from '@/lib/auth';
import { listActivations, getBillingStatus } from '@/lib/license-client';
import { isRateLimited } from '@/lib/errors';
import { checkExportCooldown } from '@/lib/export-rate-limit';
import { publicBaseUrl } from '@/lib/config';
import { fetchAllLicenses, MAX_EXPORT_LICENSES } from '@/lib/export-licenses';

// Independent Opus security review, 2026-08-22: the original version of
// this route fanned out one GET /list-activations/:key call per license
// via a single Promise.all - up to MAX_EXPORT_LICENSES concurrent
// outbound fetches from one inbound request, from a single-replica Next
// process shared by every tenant (docker-compose-coolify.yml: no
// replica count set). Bounding concurrency here caps how much of that a
// single request can do at once; the per-account cooldown in
// lib/export-rate-limit.ts caps how often a tenant can trigger it at
// all - see that file's own header for the full reasoning. Unchanged by
// the pagination fix below: a bigger MAX_EXPORT_LICENSES means more
// batches of 10, not wider fan-out per batch, so a large Business export
// simply takes longer rather than hitting the same concurrency risk this
// review found at a bigger scale.
const ACTIVATIONS_CONCURRENCY = 10;

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await fn(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

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
 *
 * Per-account cooldown (checkExportCooldown) and bounded activation-fetch
 * concurrency (mapWithConcurrency, above) added after an independent
 * Opus security review, 2026-08-22 - see both those symbols' own
 * comments and PROJECT_STATUS.md for the full finding. License fetching
 * itself is paginated (lib/export-licenses.ts's fetchAllLicenses) rather
 * than a single capped call - see that file's own comments for why.
 *
 * Fresh sweep, 2026-08-22: that cooldown's own error responses were a
 * real regression, caught before it shipped anywhere else - the trigger
 * (ExportDataSection.tsx) is a plain `<a href>` top-level navigation, by
 * design (see the Route Handler note above), so a JSON error response
 * left the browser showing raw `{"error":...}` text on a blank page
 * instead of staying on Settings. Every failure path here now redirects
 * back to /settings with a query-param outcome instead - same pattern
 * verify-email/route.ts already established for its own link-target
 * failure cases (emailChangeError), and the same publicBaseUrl() fix
 * (not request.nextUrl.origin - see that route's own comment) since
 * this, too, builds a redirect Location header.
 */
export async function GET(request: NextRequest) {
  const baseUrl = publicBaseUrl(request);
  const settingsUrl = (exportError: string) => new URL(`/settings?exportError=${exportError}`, baseUrl);

  const identity = await requireSession().catch(() => null);
  if (!identity) {
    return NextResponse.redirect(new URL('/login', baseUrl));
  }
  if (!identity.tenantId) {
    // Unreachable via the UI - the export section only renders under
    // MULTI_TENANT with a resolved tenant (see the Settings page).
    // Defense in depth, not a real self-hosted path - self-hosted's
    // single shared admin login has no accounts row to export.
    return NextResponse.redirect(settingsUrl('unavailable'));
  }

  const retryAfterSeconds = checkExportCooldown(identity.id);
  if (retryAfterSeconds !== null) {
    return NextResponse.redirect(settingsUrl('cooldown'));
  }

  const tenantApiKey = getTenantApiKey(identity.id);
  const email = getAccountEmail(identity.id);
  const tenantName = getTenantName(identity.id);

  let listResult, billing;
  try {
    [listResult, billing] = await Promise.all([
      fetchAllLicenses(tenantApiKey),
      getBillingStatus(tenantApiKey),
    ]);
  } catch (err) {
    if (isRateLimited(err)) {
      return NextResponse.redirect(settingsUrl('rate-limited'));
    }
    markIfTenantRejected(err, identity.tenantId);
    throw err;
  }
  const { licenses, total } = listResult;

  // No silent truncation - if this ever fires for a real tenant, the
  // export still succeeds with what fit rather than erroring, but says
  // so loudly server-side rather than quietly shipping an incomplete
  // "full" export. Should be rare now that fetchAllLicenses paginates
  // instead of making one capped-at-1000 call - this only fires for a
  // tenant whose total rows (including historical expired/revoked ones)
  // exceed MAX_EXPORT_LICENSES entirely.
  if (total > licenses.length) {
    console.warn(
      `Data export for tenant ${identity.tenantId} truncated: ${total} licenses, only ${licenses.length} exported (MAX_EXPORT_LICENSES=${MAX_EXPORT_LICENSES}).`
    );
  }

  // One GET /list-activations/:key call per license - N+1, not a single
  // bulk call (no such endpoint exists). Accepted the same way
  // admin-report-extract.js's own aggregate query accepts its own cost:
  // a one-time, tenant-initiated click, not a background job serving
  // every tenant on a schedule. Concurrency-bounded (ACTIVATIONS_CONCURRENCY)
  // and cooldown-gated (checkExportCooldown above), not left as a single
  // unbounded Promise.all - see this file's own header comment on why.
  let licensesWithActivations;
  try {
    licensesWithActivations = await mapWithConcurrency(licenses, ACTIVATIONS_CONCURRENCY, async (license) => ({
      key: license.key,
      product_id: license.product_id,
      // Optional (PRODUCT_UUID_DESIGN.md, casazium/license) - undefined
      // when the server omits it (field-presence convention, never sent
      // as null), which JSON.stringify below drops entirely, matching
      // every other surface's handling of this field. Previously missing
      // from this export outright - a tenant downloading "all" their
      // data got every license field except the one needed to actually
      // verify these licenses against their own SDK integration.
      product_uuid: license.product_uuid,
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
    }));
  } catch (err) {
    if (isRateLimited(err)) {
      return NextResponse.redirect(settingsUrl('rate-limited'));
    }
    markIfTenantRejected(err, identity.tenantId);
    throw err;
  }

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
      // Independent Opus security review, 2026-08-22: this was the only
      // authenticated response in the app with no Cache-Control at all -
      // Next adds one automatically to dynamic pages but not to a plain
      // NextResponse from a Route Handler. No live exploit today (no CDN
      // sits in front of this console), but a full per-tenant data dump
      // is exactly the response a future caching layer must never be
      // allowed to share across tenants.
      'Cache-Control': 'private, no-store',
    },
  });
}
