# Changelog

Notable changes to License Console, per release. This is the first
tagged release — earlier history (0.1.0 through 1.1.0) was never
tagged; see git log and `PROJECT_STATUS.md` for detail on work before
this point.

Starting with this release, every entry that changes the admin API
surface this console depends on (`casazium/license`) notes whether it
needs a corresponding change there, and vice versa — see
`SELF_HOSTED_DISTRIBUTION_DESIGN.md` §4 for why this discipline exists.

## [1.5.0] - 2026-10-07

### Added

- **Refunds in Settings → Storefront webhooks** (casazium/license
  1.8.0's revoke-on-refund). Each webhook gets **"When a purchase is
  fully refunded: Revoke the license / Keep it (record only)"** — revoke
  is the server's default for every webhook — saved immediately and
  switched back if the save fails. Its help names the refund event to
  enable (Stripe `charge.refunded`, Lemon Squeezy `order_refunded`) and
  says what either setting still does (a purchase refunded before issue
  never gets a license; a refunded purchase is never emailed) and that
  a downloaded offline license file keeps working until it expires. A
  webhook set to record only is flagged on its collapsed row. The setup
  steps name the refund event.
- **Refund status in Deliveries:** Refunded · revoked / kept, Partly
  refunded, Revoke by hand (the server couldn't revoke it), and Refunded
  first (refunded before a license was issued), with the refund date and,
  for a partial refund, the percentage refunded. A fully refunded
  purchase is never flagged as a stuck email, since the server
  deliberately doesn't send it.

### Changed

- The refund setting is hidden on a disabled webhook (#58): the License
  Server refuses changes to a disabled webhook with `409` (1.8.0), and a
  disabled webhook receives no purchases to apply it to.

Admin API surface: refunds need casazium/license **1.8.0**. The console
detects support from the server's own webhook list (`refund_policy` is
absent before 1.8.0), so against an older server nothing new appears and
everything else works unchanged. `MIN_COMPATIBLE_SERVER_VERSION` stays
1.5.3.

## [1.4.0] - 2026-10-06

### Added

- **Lemon Squeezy in Settings → Storefront webhooks**, alongside Stripe.
  "Connect Lemon Squeezy" shows the callback URL and Lemon Squeezy's own
  setup steps (subscribe the webhook to `order_created`). Lemon Squeezy
  has the vendor choose the signing secret, so the setup offers
  **Generate** (32 random hex characters) and **Copy** to paste the same
  secret into both places; a secret outside 16-40 characters is caught
  before saving, and the License Server's own message is shown if it
  rejects one. Product mappings offer the provider's own reference
  types - **Variant ID** or `casazium_ref` for Lemon Squeezy, Payment
  Link or `casazium_ref` for Stripe - and a non-numeric Variant ID is
  caught in plain language. The deliveries help explains Lemon Squeezy's
  recovery: resend the webhook from Lemon Squeezy within 7 days of the
  order, or send the key by hand.
  Admin API surface: needs casazium/license **1.7.0** for Lemon Squeezy.
  Against an older License Server, "Connect Lemon Squeezy" shows
  "Connecting Lemon Squeezy needs License Server 1.7.0 or later";
  everything else, Stripe included, works unchanged.
  `MIN_COMPATIBLE_SERVER_VERSION` stays 1.5.3.

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
