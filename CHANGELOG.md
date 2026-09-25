# Changelog

Notable changes to License Console, per release. This is the first
tagged release — earlier history (0.1.0 through 1.1.0) was never
tagged; see git log and `PROJECT_STATUS.md` for detail on work before
this point.

Starting with this release, every entry that changes the admin API
surface this console depends on (`casazium/license`) notes whether it
needs a corresponding change there, and vice versa — see
`SELF_HOSTED_DISTRIBUTION_DESIGN.md` §4 for why this discipline exists.

## [1.3.1] - 2026-09-25

### Fixed

- **Multi-arch image.** `publish-image.yml` now builds and pushes both
  `linux/amd64` and `linux/arm64` (previously `amd64` only), so
  `docker-compose.selfhosted.yml` pulls a native image on Apple Silicon
  Macs instead of failing with "no matching manifest for
  linux/arm64/v8". No application behavior changed - this is the first
  tag built by that updated workflow.

## [1.3.0] - 2026-09-25

### Added

- **Version-compatibility check.** A new, non-blocking warning banner
  in the authenticated app shell when the connected License Server
  reports a version older than this release's documented minimum.
  Does not affect standalone/demo mode or an unreachable backend -
  only ever shows on a confirmed mismatch.

### Compatibility

- **Minimum compatible License Server version for this release:
  `1.5.3`.** Hand-verified, not automatically derived (this app can't
  read `casazium/license`'s own repository). If a change on either
  side of this pairing ever needs the other to be updated, note it
  here and in the corresponding entry of `casazium/license`'s own
  `CHANGELOG.md`.

## [1.2.0] - 2026-09-25

### Added

- First tagged release. No functional change from the untagged `main`
  this version number already carried — this establishes the tag/
  changelog discipline going forward, a prerequisite for
  `SELF_HOSTED_DISTRIBUTION_DESIGN.md`'s Phase 1 (a compatibility claim
  needs a real release to pin against).
