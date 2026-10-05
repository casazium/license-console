# Changelog

Notable changes to License Console, per release. This is the first
tagged release — earlier history (0.1.0 through 1.1.0) was never
tagged; see git log and `PROJECT_STATUS.md` for detail on work before
this point.

Starting with this release, every entry that changes the admin API
surface this console depends on (`casazium/license`) notes whether it
needs a corresponding change there, and vice versa — see
`SELF_HOSTED_DISTRIBUTION_DESIGN.md` §4 for why this discipline exists.

## [1.3.6] - 2026-10-05

### Added

- **`LICENSE_ADMIN_API_KEY_FILE`**: read the License Server admin key from
  a file instead of the environment (the Docker-secrets convention), loaded
  once at startup in `instrumentation.ts` via the new `lib/secret-files.ts`.
  A value set directly still wins; a missing or empty file stops the
  console at boot instead of leaving it to 403 on every request. Same rules
  as casazium/license 1.6.2's `<NAME>_FILE` support, so the self-hosted
  bundle can point both services at one generated key file instead of
  overriding this image's start command with a shell wrapper. Admin API
  surface: no change needed in `casazium/license` beyond its own 1.6.2.

## [1.3.5] - 2026-09-28

### Fixed

- **Portal links now use the License Server's public address.**
  `buildPortalLink()` derived the customer-facing portal link from
  `LICENSE_API_URL`, which is only right when that URL is publicly
  reachable. In `casazium/license`'s self-hosted bundle it's the compose
  network's internal `http://license:3001/v1`, so every portal link the
  console showed after issuing a license pointed at a host customers
  can't resolve. A new optional `LICENSE_PUBLIC_URL` (the server's public
  origin) now takes precedence when set; unset, behavior is unchanged.
  Admin API surface: no change needed in `casazium/license`. The bundle
  sets `LICENSE_PUBLIC_URL` itself and pins `CONSOLE_TAG` to this
  release.

## [1.3.4] - 2026-09-28

No changes from 1.3.3. The `v1.3.4` tag was pushed before the fix now
in 1.3.5 had been committed, so its published image contains the same
code as 1.3.3. Use 1.3.5.

## [1.3.3] - 2026-09-26

### Fixed

- **Issue-license success screen: copy button for the license key.**
  Same gap as 1.3.2's license detail page fix, found on a different
  screen: `product_uuid` on the "License issued" success panel already
  had a copy button, but the key itself - the value actually needed
  first after issuing a license - didn't.

## [1.3.2] - 2026-09-25

### Fixed

- **License detail page: copy button for the license key, and
  back-to-list links.** The license key had no copy affordance even
  though `product_uuid` right below it already had one via the same
  `CopyValueButton` component - the key is the value actually pasted
  into support tickets, `curl` commands, and customer app config, more
  often than `product_uuid` is. Also added "Back to Licenses" links
  (not-found fallback and bottom of page), matching the identical
  pattern already on the sibling release detail page. Found via manual
  UI testing.

### Docs

- **`README.selfhosted.md`** now documents a Docker-networking gotcha:
  running the License Server directly on the host while this console
  runs in its own container fails silently if `LICENSE_API_URL` points
  at `127.0.0.1` (that resolves to the container, not the host) -
  documents the `host.docker.internal` fix and the Linux Docker Engine
  caveat.

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
