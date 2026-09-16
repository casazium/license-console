/**
 * Mode dispatcher for the license-server client. Every page imports from
 * this file (not license-client.mock.ts or license-client.live.ts
 * directly), and gets routed to one or the other per call based on
 * whether LICENSE_API_URL / LICENSE_ADMIN_API_KEY are configured - see
 * getBackendMode() below. This is what makes "standalone (look-and-feel-
 * only) mode" possible: run the console with neither var set and it
 * behaves exactly as it always has, no code changes, no separate build.
 *
 * Mode is read fresh on every call (not cached at module load) so a
 * changed .env takes effect on the next request without a rebuild -
 * consistent with how branding config is handled (lib/branding.ts).
 */

import * as live from './license-client.live';
import * as mock from './license-client.mock';

export type {
  Activation,
  BillingStatus,
  DashboardStats,
  ExpiringLicense,
  IssueLicenseInput,
  License,
  LicenseLimits,
  LicenseListItem,
  ListLicensesParams,
  ListLicensesResult,
  ListReleasesParams,
  ListReleasesResult,
  RecentActivation,
  RecentlyIssuedLicense,
  RegisterReleaseInput,
  RegisterReleaseResult,
  Release,
  ReleaseDetail,
  SeatUtilization,
  SelfLicenseStatus,
  TierAStatus,
  UpdateLicenseTermsInput,
  UpdateLicenseTermsResult,
} from './license-types';

export type BackendMode = 'mock' | 'live';

/**
 * Both LICENSE_API_URL and LICENSE_ADMIN_API_KEY set -> live (real
 * backend). Both unset -> mock (standalone, look-and-feel only). Exactly
 * one set is almost certainly a misconfiguration (e.g. a typo'd env var
 * name), not an intentional choice - fails fast with a clear message
 * rather than silently guessing which mode was meant.
 */
export function getBackendMode(): BackendMode {
  const hasUrl = Boolean(process.env.LICENSE_API_URL?.trim());
  const hasKey = Boolean(process.env.LICENSE_ADMIN_API_KEY?.trim());

  if (hasUrl && hasKey) return 'live';

  if (hasUrl || hasKey) {
    throw new Error(
      'LICENSE_API_URL and LICENSE_ADMIN_API_KEY must both be set (connected to a real ' +
        'license server) or both left unset (standalone, look-and-feel-only mode) - ' +
        `found only ${hasUrl ? 'LICENSE_API_URL' : 'LICENSE_ADMIN_API_KEY'} configured.`
    );
  }

  // Both unset. In production this is ambiguous by itself: it's the
  // documented way to deploy an intentional standalone/demo instance
  // (docker-compose-coolify.yml's header comment), but it's exactly what
  // an operator also gets by *forgetting* to configure live mode - Coolify
  // interpolates a missing ${LICENSE_API_URL} to an empty string, which
  // .trim() makes indistinguishable from genuinely unset. An admin who
  // believes they're managing real licenses but is silently looking at
  // demo fixtures is a real-world bad outcome for a licensing system, not
  // just a cosmetic one. Require an explicit opt-in to tell the two apart
  // in production; dev/test keep the zero-config default so `npm run dev`
  // still just works with no .env at all.
  if (process.env.NODE_ENV === 'production' && process.env.LICENSE_STANDALONE_MODE !== 'true') {
    throw new Error(
      'LICENSE_API_URL and LICENSE_ADMIN_API_KEY are both unset in a production build. ' +
        'If this is an intentional standalone/demo deployment, set LICENSE_STANDALONE_MODE=true ' +
        'to confirm - otherwise this looks like live mode was meant but never configured.'
    );
  }

  return 'mock';
}

/**
 * TASK_A1_LICENSE_PORTAL.md - the end-user license portal lives at the
 * license server's own root, not under its /v1 API prefix (that repo's
 * own "Route placement" reasoning: it's an HTML page, not part of the
 * versioned JSON API). LICENSE_API_URL always includes /v1
 * (.env.example's own documented format), so building a real portal link
 * means stripping that suffix, not just a trailing slash the way
 * apiBaseUrl (Settings page) leaves it for API-call display purposes.
 * Returns null in mock/standalone mode (no real backend to link to) so
 * callers can show a fallback rather than a broken link.
 */
export function buildPortalLink(token: string): string | null {
  const url = process.env.LICENSE_API_URL?.trim();
  if (!url) return null;
  const origin = url.replace(/\/+$/, '').replace(/\/v1$/, '');
  return `${origin}/portal/${encodeURIComponent(token)}`;
}

function client() {
  return getBackendMode() === 'live' ? live : mock;
}

// Every export below forwards its trailing `tenantApiKey` straight
// through (SaaS-B2) - self-hosted callers never pass it, so `undefined`
// flows through unchanged and each function behaves exactly as it did
// before this task.
export const listLicenses: typeof mock.listLicenses = (params, tenantApiKey) =>
  client().listLicenses(params, tenantApiKey);
export const getLicense: typeof mock.getLicense = (key, tenantApiKey) => client().getLicense(key, tenantApiKey);
export const issueLicense: typeof mock.issueLicense = (input, tenantApiKey) =>
  client().issueLicense(input, tenantApiKey);
export const setLicenseRevoked: typeof mock.setLicenseRevoked = (key, revoked, tenantApiKey) =>
  client().setLicenseRevoked(key, revoked, tenantApiKey);
export const updateLicenseNotes: typeof mock.updateLicenseNotes = (key, notes, tenantApiKey) =>
  client().updateLicenseNotes(key, notes, tenantApiKey);
export const updateLicenseTerms: typeof mock.updateLicenseTerms = (input, tenantApiKey) =>
  client().updateLicenseTerms(input, tenantApiKey);
export const deleteLicense: typeof mock.deleteLicense = (key, tenantApiKey) =>
  client().deleteLicense(key, tenantApiKey);
export const listActivations: typeof mock.listActivations = (key, tenantApiKey) =>
  client().listActivations(key, tenantApiKey);
export const reissueActivationToken: typeof mock.reissueActivationToken = (key, instanceId, tenantApiKey) =>
  client().reissueActivationToken(key, instanceId, tenantApiKey);
export const reissuePortalToken: typeof mock.reissuePortalToken = (key, tenantApiKey) =>
  client().reissuePortalToken(key, tenantApiKey);
export const deactivateByInstanceId: typeof mock.deactivateByInstanceId = (key, instanceId, tenantApiKey) =>
  client().deactivateByInstanceId(key, instanceId, tenantApiKey);
export const deleteAccount: typeof mock.deleteAccount = (tenantApiKey) =>
  client().deleteAccount(tenantApiKey);
export const rotateApiKey: typeof mock.rotateApiKey = (tenantApiKey) =>
  client().rotateApiKey(tenantApiKey);
export const getDashboardStats: typeof mock.getDashboardStats = (tenantApiKey) =>
  client().getDashboardStats(tenantApiKey);
export const getRecentActivations: typeof mock.getRecentActivations = (limit, tenantApiKey) =>
  client().getRecentActivations(limit, tenantApiKey);
export const getExpiringLicenses: typeof mock.getExpiringLicenses = (withinDays, limit, tenantApiKey) =>
  client().getExpiringLicenses(withinDays, limit, tenantApiKey);
export const getLicensesNearSeatLimit: typeof mock.getLicensesNearSeatLimit = (limit, tenantApiKey) =>
  client().getLicensesNearSeatLimit(limit, tenantApiKey);
export const getRecentlyIssuedLicenses: typeof mock.getRecentlyIssuedLicenses = (limit, tenantApiKey) =>
  client().getRecentlyIssuedLicenses(limit, tenantApiKey);
export const getBillingStatus: typeof mock.getBillingStatus = (tenantApiKey) =>
  client().getBillingStatus(tenantApiKey);
export const createCheckoutSession: typeof mock.createCheckoutSession = (plan, interval, tenantApiKey) =>
  client().createCheckoutSession(plan, interval, tenantApiKey);
export const completeStubCheckout: typeof mock.completeStubCheckout = (plan, tenantApiKey) =>
  client().completeStubCheckout(plan, tenantApiKey);
export const getSelfLicenseStatus: typeof mock.getSelfLicenseStatus = (tenantApiKey) =>
  client().getSelfLicenseStatus(tenantApiKey);
export const listReleases: typeof mock.listReleases = (params, tenantApiKey) =>
  client().listReleases(params, tenantApiKey);
export const registerRelease: typeof mock.registerRelease = (input, tenantApiKey) =>
  client().registerRelease(input, tenantApiKey);
export const unpublishRelease: typeof mock.unpublishRelease = (id, tenantApiKey) =>
  client().unpublishRelease(id, tenantApiKey);
export const getRelease: typeof mock.getRelease = (id, tenantApiKey) =>
  client().getRelease(id, tenantApiKey);
export const getTierAStatus: typeof mock.getTierAStatus = (tenantApiKey) =>
  client().getTierAStatus(tenantApiKey);
