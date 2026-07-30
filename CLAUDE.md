# CLAUDE.md

Version: 1.0
Last updated: 2026-07-30

> Repository-specific operating instructions for Claude Code, scoped to
> `casazium/license-console`. This repo does not use the heavier
> approval-gate/artifact-lifecycle process defined for `casazium/casazium`
> (`ENGINEERING_PLAYBOOK.md`) — that process exists there for audit/compliance
> reasons specific to that repo's history and isn't warranted here yet. This
> file intentionally stays small; expand it only when a real need shows up.

---

## 1. Role

You are building and maintaining the admin console UI for `casazium/license`
— a self-hosted, single-tenant license server. This repo is a fresh Next.js +
Mantine app; most of it doesn't exist yet.

## 2. Repository orientation

- **Stack:** Next.js (App Router) + Mantine. Next.js was chosen specifically
  for its server-side layer (Route Handlers / Server Components / middleware),
  used as a BFF so the license server's admin credential never reaches the
  browser — not for routing convenience.
- **Backend:** `casazium/license` (Fastify 5 + better-sqlite3, separate repo).
  Admin auth there is a single static `ADMIN_API_KEY` bearer token checked by
  a `requireAdmin` preHandler hook — no user accounts on that side.
- **Auth model here:** single shared admin password for now, deliberately
  structured (`lib/auth.ts` / `lib/session.ts` / `middleware.ts` seam) so
  adding real per-user accounts later doesn't require rearchitecting the
  session layer. Full rationale in `PROJECT_STATUS.md` §3.
- **Current state:** scaffolding not yet started; the repo contains only this
  file and `PROJECT_STATUS.md`.

## 3. Startup procedure

`CLAUDE.md` itself is auto-loaded by Claude Code before any turn starts — do
not re-read it as a step. At the beginning of every session:

1. Read `PROJECT_STATUS.md` in full — it holds the architecture decisions,
   MVP/phase-2 scope, and the backend reference notes. Don't re-derive
   decisions already recorded there.
2. Inspect Git: branch, commit, working tree, recent commits.
3. Summarize current state and the next unstarted item from `PROJECT_STATUS.md`
   §7 (or wherever "next step" is recorded).
4. Wait for user instruction before modifying files.

## 4. Session behavior

- **Git discipline:** do not commit, push, or tag unless explicitly
  instructed. A clean working tree at session end is preferable to holding
  uncommitted work — if something must be preserved unapproved, say so rather
  than committing silently.
- **Keep `PROJECT_STATUS.md` current.** When a scope or architecture decision
  changes in conversation, update the document in the same session rather
  than letting it drift — it's the sole cross-session memory for this repo.

---

## Revision History

| Version | Date | Summary |
| --- | --- | --- |
| 1.0 | 2026-07-30 | Initial version. Deliberately scoped light: repo orientation, startup procedure pointing to `PROJECT_STATUS.md`, and inline git discipline — no separate playbook file. |
