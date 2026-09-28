# Self-hosted Console: support boundary policy

Status: Approved — folded into `SELF_HOSTED_DISTRIBUTION_DESIGN.md` §5
2026-09-28, replacing the "Support boundary - still open, same
deferral" bullet. Resolves the item that was explicitly left
unresolved ("too early to decide") while the Console stayed private.
It was revisited because `casazium/license` Tier B (self-hosted
subscription) is a real, priced product this policy needed to cover
before the Console could ship alongside it.

## What already exists to build this on

Nothing here is invented from scratch — Phase 1 (§4 of
`SELF_HOSTED_DISTRIBUTION_DESIGN.md`) already built the mechanism this
policy just has to put a commitment around:

- **`lib/version.ts`'s `MIN_COMPATIBLE_SERVER_VERSION`.** Each Console
  release records the minimum License Server version it's been
  verified against. `isServerVersionCompatible()` compares the
  connected server's reported version against it.
- **A visible, non-blocking warning on mismatch, never a hard
  failure.** Deliberately mirrors `check-sea-release-lag.sh`'s
  non-blocking philosophy — a self-hoster's uptime doesn't depend on
  Casazium's version-range guess being exactly right.
- **`CHANGELOG.md` discipline.** Every Console release notes whether it
  needs a corresponding `casazium/license` admin-API change, and vice
  versa (§4 item 5) — the one piece of process this design doc's
  investigation found completely absent before Phase 1.

This policy answers the question that mechanism doesn't: when a
customer's setup falls outside what's covered, what does Casazium
actually do about it?

## The policy

**1. Compatibility window: the two most recent Console minor
releases.** Casazium provides support (bug reports investigated,
security fixes backported) for the current Console release and the
one immediately prior. This is deliberately narrow — Casazium is a
one-person operation, and a self-hosted admin console with no
forced-update mechanism could otherwise accumulate an unbounded set of
versions to reason about. It's also not stingy: for a product with a
release cadence measured in weeks, not days (see `CHANGELOG.md`'s own
history), two releases back is normally measured in months, not days.

**2. No forced upgrades.** There is no auto-update mechanism for a
self-hosted Console, and none is planned (`SELF_HOSTED_DISTRIBUTION_
DESIGN.md` explicitly scopes "a hard version-enforcement gate" out of
Phase 1). A customer can stay on an older release indefinitely without
losing the right to run it. What changes outside the compatibility
window in #1 is Casazium's *support* commitment, not the license grant
to keep running it.

**3. Below `MIN_COMPATIBLE_SERVER_VERSION`: upgrade the server, not the
Console.** If the connected License Server predates the running
Console release's documented minimum, the customer sees the existing
warning banner. Casazium's commitment: point the customer at the
License Server upgrade path (self-hosted License Server upgrades are
already documented in `casazium/license`'s own installation guide);
Casazium does not debug symptoms that are actually version-mismatch
artifacts as if they were Console bugs. If a reported issue turns out
to be exactly that, the response is "upgrade the server," not a Console
patch.

**4. Outside the compatibility window (#1): update the Console
first.** If a customer reports an issue while running a Console
release older than the two most recent, the first response is to ask
them to update before further investigation — mirroring how
`casazium/license` itself already handles support requests against an
outdated SEA/Docker build (see that repo's own release-lag precedent).
Security fixes are the one exception: a genuinely serious
vulnerability gets backported to the oldest release still inside the
compatibility window in #1, not just the newest.

**5. Forward compatibility (newer License Server than the Console
expects) is assumed, not guaranteed.** `MIN_COMPATIBLE_SERVER_VERSION`
is a floor, not a ceiling — there's no maximum-version check, and
ordinary API additions in `casazium/license` shouldn't break an older
Console. But this is an assumption, not a tested guarantee: the
`CHANGELOG.md` discipline in the existing mechanism (Phase 1 item 5) is
what actually catches the exception, by requiring any
`casazium/license` admin-API change that isn't backward-compatible to
say so explicitly. If a `casazium/license` release doesn't flag a
breaking change there, treat that as a process failure to fix, not as
grounds to promise every future combination works.

**6. No uptime or response-time SLA.** Matches the EULA's existing
Warranty Disclaimer (Section 9) and Limitation of Liability (Section
10) for License Server itself — this policy is a support-scope
statement, not a service-level commitment. "Supported" in #1 and #4
means Casazium will investigate and, where the issue is real and
inside scope, fix it — not a guaranteed response time.

**7. Discontinuation.** Covered by the EULA amendment (see
`casazium/license/EULA_CONSOLE_AMENDMENT_DRAFT.md`), not by this
policy — Section 8's final-build guarantee, once extended to the
Console, already handles what happens if Casazium ever stops offering
either product. This policy only governs the ordinary, ongoing support
relationship.

**8. Bundle customers: a version mismatch is self-inflicted, not the
default.** Items #1-#5 above were written for Console's standalone
`docker-compose.selfhosted.yml`, where Console and License Server are
deployed and versioned independently by design — a mismatch there is
the normal condition the policy exists to handle. The Tier B bundle
(`casazium/license/tier-b-bundle/`) is different: `LICENSE_TAG` and
`CONSOLE_TAG` are pinned together in one shared `.env` as a
pre-verified pair (see that bundle's `.env.example`, which records the
`MIN_COMPATIBLE_SERVER_VERSION` check the pairing was verified
against), and its README's only documented upgrade path is bumping
both to a newer verified pair at once. So if a bundle customer hits the
compatibility warning, the first diagnostic question is not "which
compatibility window are you in" (#1) but "did you edit `LICENSE_TAG`
or `CONSOLE_TAG` independently of the README's upgrade instructions" —
that's the far more likely cause, and the fix is to restore the pinned
pair rather than to walk through #3/#4. Items #1-#6 still apply once
that's ruled out.

## What this deliberately doesn't cover

- **Multi-user/multi-admin self-hosted mode.** Explicitly out of scope
  for Phase 1 engineering (`SELF_HOSTED_DISTRIBUTION_DESIGN.md` §4) —
  there's nothing to support here yet because the feature doesn't
  exist.
- **SEA/single-binary distribution for the Console.** Same document,
  same reason — Docker-only today.
- **Pricing** (whether the Console is free with Tier B, a paid add-on,
  or something else). A separate, still-open decision; this policy
  applies however that's resolved.

## Status

Approved by the operator 2026-09-28 and folded into
`SELF_HOSTED_DISTRIBUTION_DESIGN.md` §5, replacing the "still open"
support-boundary bullet with a summary and a pointer back to this file.
See `PROJECT_STATUS.md` for the dated record.
