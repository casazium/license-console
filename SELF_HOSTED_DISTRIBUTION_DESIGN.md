# License Console for Third-Party Self-Hosting: Design Decisions

Status: Draft - not reviewed, not approved, no implementation started.
Written from research only (two independent Explore passes over this
repo and `casazium/license`); no code changed.
Last updated: 2026-09-25

> Design record for whether and how to distribute License Console as a
> third-party self-hosted artifact, alongside `casazium/license`'s
> existing Docker/SEA self-hosted distribution. Written so a later
> session (human or AI) doesn't have to re-derive the same research: the
> architecture question and the compatibility question were each
> investigated separately, against real code, not assumed.

---

## 1. Context

Self-hosted License Server customers administer their instance entirely
through the raw admin API today - `curl`, or whatever wrapper they build
themselves. This was confirmed and documented as a deliberate, coherent
state in `casazium/casazium`'s `PROJECT_STATUS.md` (the storefront guide
originally assumed a console self-hosters don't have), which also
recorded the open question this doc answers: *"Whether a self-hosted
install should ever have a console... if that changes it has EULA
implications, since [the EULA's] final build covers 'the Software' as
defined to be License Server alone."*

License Console exists today as one thing Casazium operates:
`license-cloud.casazium.com`, a SaaS-mode deployment. The question this
doc scopes is whether that same codebase could *also* be handed to
third parties running their own License Server, the way License Server
itself already ships two ways (Docker image, Node SEA binary).

## 2. Finding: this is not a redesign - self-hosted mode is the app's original design point

This was the first thing verified, because it changes the entire shape
of the problem. **License Console was built self-hosted-first; SaaS was
added on top later, not the other way around:**

- `PROJECT_STATUS.md`'s own §1 states the original purpose in exactly
  these terms: an admin UI "for operating a self-hosted instance of
  `casazium/license` (single-tenant license server - each operator, e.g.
  an indie developer, runs their own instance)."
- The SaaS/multi-tenant tier was scoped later (§29, 2026-08-04) as an
  addition "alongside (not replacing) the self-hosted product." Both
  modes are live in `main` today, selected by one flag: `MULTI_TENANT`
  (`lib/config.ts`).

**With `MULTI_TENANT` unset (self-hosted, the default):**
- Auth is a single shared admin login (`ADMIN_UI_USERNAME`/
  `ADMIN_UI_PASSWORD`, constant-time compared, `lib/auth.ts`) - no
  signup, no per-user accounts, no database-backed identity.
  `/signup` and `POST /api/signup` both 404 (`app/signup/page.tsx`).
- Every license/activation/release page reads live from the configured
  License Server via `lib/license-client.live.ts` - `LICENSE_API_URL`
  and `LICENSE_ADMIN_API_KEY` are always operator-supplied env vars,
  never hardcoded or defaulted to a Casazium-operated backend. Their
  total absence is itself a supported "standalone/demo" mode
  (`LICENSE_STANDALONE_MODE`), not an error.
- Billing has **no Stripe SDK anywhere in this repo** - the `/billing`
  nav item and route tree are gated off entirely under self-hosted mode
  (`app/(app)/AppShellClient.tsx`), and even under SaaS mode the console
  only follows a URL the License Server hands back; there's no
  webhook handler or subscription logic here to strip out.
- The console keeps its own SQLite DB (`lib/db.ts`), but only for
  console-identity concerns (accounts, tokens, branding) - in self-hosted
  mode it "is expected to start empty and hold nothing worth protecting"
  (the code's own comment). No license data is ever cached there.
- A production-grade Dockerfile already exists: multi-stage, non-root,
  Next's `output: 'standalone'`, Litestream/rclone for optional backups.
  No plain third-party `docker-compose.yml` exists yet - only
  `docker-compose-coolify.yml`, which is explicit that it deploys as a
  resource fully independent from `casazium/license`'s own compose file.

**Conclusion:** the engineering lift for "can this run self-hosted" is
already paid for. What's missing is packaging for a party other than
Casazium itself to run it - see §4.

## 3. Finding: there is no version-compatibility mechanism between Console and Server, and this is a real gap

This is the one place research changed the recommendation rather than
just confirming it was cheap.

- License Server's admin API has only a static `/v1` URL prefix -
  effectively a permanent label, not an evolving contract version. No
  envelope version field, no `Accept`/`API-Version` header convention.
  `openapi.yaml`'s `info.version` has been hardcoded to `1.0.0` since
  before v1.0 shipped and has never moved with real releases.
- License Console does fetch and display the server's version in a
  footer (`getBackendVersion()` in `lib/license-client.live.ts`,
  rendered by `components/VersionStamp.tsx`) - but it's purely cosmetic:
  no minimum-version check, no gating, failures swallowed silently. It
  was added after an operator noticed drift by eye, not designed ahead
  of need (`PROJECT_STATUS.md` §110).
- No README/DEPLOYMENT.md in either repo states a required or minimum
  paired version. `package.json` versions are fully independent (Server
  at 1.5.3; Console at 1.2.0, which **has never had a git tag** - it's
  continuously deployed off `main` with no discrete release identity).
- Coupling in practice is tight but organic and reactive, not
  contractual: the server has repeatedly grown new admin routes
  specifically because the console needed them (e.g. `GET
  /admin/license/:key`, added for exactly this reason per
  `PROJECT_STATUS.md` §13). A real breaking redesign on the server side
  (the `product_uuid` migration, `CHANGELOG.md` `[1.3.0]`) was picked up
  in the console via a separate, later, manually-initiated session - the
  server's own changelog entry never flagged that a console update was
  needed.
- **Direct precedent for what goes wrong here:** License Server already
  had a real incident from this exact shape internally - its own SaaS
  artifact (Docker, deploys on every push to `main`) and its own
  self-hosted artifact (SEA, only rebuilds on a version tag) drifted 36+
  commits apart before anyone noticed, fixed only by adding a
  non-blocking lag-check script (`scripts/check-sea-release-lag.sh`).
  A self-hosted Console (continuous, no tags today) paired with a
  self-hosted Server (tag-gated releases) reproduces the identical
  pattern, just now split across two separate repos with no shared
  script watching for it.
- One real live cross-repo failure is already on record: a self-hosted
  Console deployment hit a `403` on first boot from an asymmetric
  API-key-trimming bug between the two repos (`PROJECT_STATUS.md` §60).
  Not a version bug, but the only existing evidence of what a real
  third-party pairing failure actually looks like in practice - and it
  was caught by a human watching a live deploy, not by any automated
  check.

**Conclusion:** nothing here has ever needed a compatibility contract
because both products have only ever been run together, on versions
Casazium controls on both sides. Handing this to third parties, who
will upgrade the two independently and unpredictably, removes that
assumption. This is real, net-new work - not large, but not zero.

## 4. Scope for a Phase 1

Following `NODE_SEA_DESIGN.md`'s own precedent of bounding a first phase
tightly rather than solving everything at once:

**In scope for Phase 1 - the engineering only. Per the 2026-09-25
decision in §5, the product stays private for now: nothing here is
publicly published, registered, or announced until a further decision
to distribute it externally.**
1. Build and publish the image to a private/access-controlled
   registry - the same build as today's, just made consumable outside
   Casazium's own Coolify resource for internal or pilot use. Moving to
   a public registry is a separate, later decision (§5).
2. Write a plain, non-Coolify `docker-compose.yml` + `.env.example`,
   following the exact pattern `casazium/license`'s own self-hosted
   quickstart zip already establishes - kept out of that public zip for
   now, handed out directly if/when there's a pilot customer rather
   than bundled into a public download.
3. Give License Console actual tagged releases (it has none today) so a
   compatibility claim has something to pin against.
4. Replace the cosmetic version footer with a real, minimal
   compatibility check: on boot (or on the dashboard), compare the
   configured License Server's reported version against a documented
   compatible range for the running Console version, and surface a
   visible warning - not a hard failure - on mismatch. This mirrors
   `check-sea-release-lag.sh`'s own non-blocking philosophy rather than
   inventing a stricter one.
5. Document a compatible-version range per Console release in its
   `CHANGELOG.md`, and require any admin-API-shape change in
   `casazium/license`'s own `CHANGELOG.md` to note whether it needs a
   Console update - the one piece of process discipline this
   investigation found completely absent.
6. ~~Documentation on `casazium/casazium`'s docs site introducing the
   console as an optional add-on to a self-hosted License Server
   install.~~ Deferred with the rest of external distribution (§5) -
   nothing public-facing until that decision is revisited.

**Explicitly out of scope for Phase 1 (real, but separate work):**
- **SEA distribution for the console.** The Server's SEA build works
  because it's a plain Node script; Next.js's build/runtime shape is
  substantially less charted territory for Node's single-executable
  packaging. Docker-only is a reasonable place to stop, not a
  compromise - worth a small standalone spike later if there's real
  demand, not assumed to work.
- **Full account/multi-user self-hosted mode.** Self-hosted deployments
  are already single-operator by construction; there's no evidence
  anyone self-hosting needs more than the one shared admin login that
  already exists.
- **A hard version-enforcement gate** (refusing to boot on mismatch).
  The existing precedent in this codebase (`check-sea-release-lag.sh`,
  the mode-mismatch note in `DEPLOYMENT.md`) favors visible warnings
  over refusal, and a self-hosting customer's own uptime shouldn't
  depend on Casazium's release cadence guesses being exactly right.

## 5. Decisions and remaining open items

- **Pricing/positioning - decided 2026-09-25: build it, keep it
  private for now.** The operator's call: proceed with the Phase 1
  engineering in §4, but the product is not publicly published,
  registered, or announced yet - not a pricing tier decision (free vs.
  paid) so much as a distribution-readiness one. Whether/when it
  becomes a public, priced, or free offering is a separate decision to
  make once there's something real to point at (a private/pilot
  deployment working end to end), not before. §4's item 1 (registry)
  and item 6 (public docs) reflect this directly.
- **EULA scope - still open, explicitly deferred until before any
  external distribution** (operator's instruction: "too early to
  decide"). Moot while the product stays private - nothing is being
  distributed under any terms yet - but must be resolved before item 1
  or item 6 in §4 could ever move from private to public. Still
  flagged, unresolved, in `casazium/casazium`'s own `PROJECT_STATUS.md`.
- **Support boundary - still open, same deferral** (operator's
  instruction: "too early to decide"). Also moot while private: there's
  no third party yet whose version drift needs a support policy. The
  compatibility mechanism in §4.3-4.5 should still be built now
  regardless - it protects Casazium's own private/pilot use just as
  much as a future external customer's - but the *policy* for what's
  supported when it's violated waits until there's someone outside
  Casazium actually running it.
- **What `license.casazium.com` actually was - checked, not just
  inferred, and the inference was wrong.** An earlier draft of this
  section speculated it might have been a self-hosted-mode instance
  Casazium ran for its own/demo use - real precedent either way. It
  wasn't. `casazium/casazium`'s `PROJECT_STATUS.md` (2026-09-23 entry,
  retirement of that host) states plainly that `license.casazium.com`
  and `license-cloud.casazium.com` served byte-identical pages because
  **one single Coolify deployment answered to both DNS names** - not
  because two separate instances happened to look alike. Retiring
  `license.casazium.com` removed a redundant DNS/Coolify alias pointing
  at the same SaaS deployment; there was never a second, self-hosted-mode
  instance behind it. That document even flags this exact
  "these two hosts must be separate instances" inference as a *repeated*
  mistake (made once before, 2026-09-06, corrected the same way). There
  is no existing precedent, in this project's history, for a
  self-hosted-mode Console deployment - this doc's §2 stands on the code
  itself, not on any prior deployment of it.
- **Support boundary.** Once this ships to parties Casazium doesn't
  operate, what's actually supported when their License Server and
  Console versions drift beyond the documented range - best-effort, or
  unsupported until they update?

## 6. Recommendation

Proceed with Phase 1 as scoped in §4, kept private per §5's 2026-09-25
decision - build the artifacts and the compatibility mechanism now,
without publishing or announcing anything externally yet. The
architecture risk that would
have made this expensive doesn't exist - self-hosted mode is already
built, already the app's original design point, and already cleanly
separated from every SaaS-only concern. The real cost is the
compatibility mechanism in §4.3-4.5, which is modest (tagged releases +
a visible, non-blocking version-mismatch warning + a changelog
discipline) precisely because License Server already solved the
analogous continuous-vs-tagged problem for itself and left a pattern to
follow rather than one to invent.
