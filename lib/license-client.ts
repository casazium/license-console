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
  DashboardStats,
  ExpiringLicense,
  IssueLicenseInput,
  License,
  LicenseListItem,
  ListLicensesParams,
  ListLicensesResult,
  RecentActivation,
  RecentlyIssuedLicense,
  SeatUtilization,
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

function client() {
  return getBackendMode() === 'live' ? live : mock;
}

export const listLicenses: typeof mock.listLicenses = (params) => client().listLicenses(params);
export const getLicense: typeof mock.getLicense = (key) => client().getLicense(key);
export const issueLicense: typeof mock.issueLicense = (input) => client().issueLicense(input);
export const setLicenseRevoked: typeof mock.setLicenseRevoked = (key, revoked) =>
  client().setLicenseRevoked(key, revoked);
export const updateLicenseNotes: typeof mock.updateLicenseNotes = (key, notes) =>
  client().updateLicenseNotes(key, notes);
export const deleteLicense: typeof mock.deleteLicense = (key) => client().deleteLicense(key);
export const listActivations: typeof mock.listActivations = (key) => client().listActivations(key);
export const reissueActivationToken: typeof mock.reissueActivationToken = (key, instanceId) =>
  client().reissueActivationToken(key, instanceId);
export const getDashboardStats: typeof mock.getDashboardStats = () => client().getDashboardStats();
export const getRecentActivations: typeof mock.getRecentActivations = (limit) =>
  client().getRecentActivations(limit);
export const getExpiringLicenses: typeof mock.getExpiringLicenses = (withinDays, limit) =>
  client().getExpiringLicenses(withinDays, limit);
export const getLicensesNearSeatLimit: typeof mock.getLicensesNearSeatLimit = (limit) =>
  client().getLicensesNearSeatLimit(limit);
export const getRecentlyIssuedLicenses: typeof mock.getRecentlyIssuedLicenses = (limit) =>
  client().getRecentlyIssuedLicenses(limit);
