// APP_VERSION/GIT_SHA are computed once at build time in next.config.mjs's
// `env` block (see the comment there for why - the Docker runner stage has
// no .git to read from at request time). Fallbacks here are defensive only
// - next.config.mjs's env block runs for both `next dev` and `next build`,
// so these should always be present in practice.
export type AppVersion = {
  version: string;
  gitSha: string;
};

export function getAppVersion(): AppVersion {
  return {
    version: process.env.APP_VERSION || '0.0.0',
    gitSha: process.env.GIT_SHA || 'unknown',
  };
}

// Minimum License Server version this Console release has actually been
// verified against - the version-compatibility mechanism
// SELF_HOSTED_DISTRIBUTION_DESIGN.md's Phase 1 calls for, since nothing
// else ties these two independently-versioned products together (no
// envelope version, no negotiated contract - see that doc's §3). Hand-
// verified and recorded here, not derived automatically - the same
// "recorded in the script/constant itself" approach
// check-release-cap-consistency.sh already uses for a cross-repo value
// this app can't read directly. Update this, and add a CHANGELOG.md
// entry noting the new value, whenever a change here starts depending on
// a License Server admin API feature this constant doesn't already
// guarantee.
export const MIN_COMPATIBLE_SERVER_VERSION = '1.5.3';

// Simple major.minor.patch comparison - not full semver (no prerelease/
// build metadata support), which is all either product's own versioning
// scheme actually uses. Returns null, not false, when either version
// can't be parsed this way (e.g. getBackendVersion() returned 'unknown',
// or a future version string this never anticipated) - a compatibility
// warning should only ever show on a CONFIRMED mismatch, never on a
// version this check simply couldn't understand.
export function isServerVersionCompatible(serverVersion: string): boolean | null {
  const parse = (v: string): [number, number, number] | null => {
    const parts = v.split('.').map(Number);
    if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
    return parts as [number, number, number];
  };
  const min = parse(MIN_COMPATIBLE_SERVER_VERSION);
  const actual = parse(serverVersion);
  if (!min || !actual) return null;
  for (let i = 0; i < 3; i++) {
    if (actual[i] > min[i]) return true;
    if (actual[i] < min[i]) return false;
  }
  return true;
}
