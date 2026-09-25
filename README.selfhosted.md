# License Console — Self-Hosted Quickstart

An admin UI for a self-hosted License Server, so you don't have to
administer it with raw `curl` calls against the admin API. This is a
private handout, not a public download yet — see
`SELF_HOSTED_DISTRIBUTION_DESIGN.md` for why.

## 1. Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose (bundled with Docker Desktop)
- A GitHub personal access token with read access to this repository's
  packages — the image isn't public. Ask whoever handed you this
  package for one if you don't already have it.
- Optionally, a running self-hosted License Server to point this at
  (see that product's own quickstart) — you can also try this console
  on its own first, with no backend at all (step 4, option A).

## 2. Log in to the private image registry

```bash
echo "<your-token>" | docker login ghcr.io -u <your-github-username> --password-stdin
```

Without this, `docker compose pull`/`up` fails with `unauthorized` — this
is expected until you've logged in, not a bug.

## 3. Configure

```bash
cp .env.selfhosted.example .env
mkdir -p data
```

Fill in `SESSION_SECRET`, `ADMIN_UI_USERNAME`, and `ADMIN_UI_PASSWORD`
in `.env` — each has a ready-to-run generator command in
`.env.selfhosted.example`'s own comments where one applies. Set
`PUBLIC_BASE_URL` to wherever this console will actually be reachable
from (not the `127.0.0.1` address `docker-compose.selfhosted.yml`
binds to locally — that's only reachable from this host itself; put a
real reverse proxy with TLS in front of this container for anything
beyond a local trial).

## 4. Point it at a backend (or don't, yet)

**A. Try it standalone first, no License Server needed.** Leave
`LICENSE_API_URL`/`LICENSE_ADMIN_API_KEY` unset in `.env` and set
`LICENSE_STANDALONE_MODE=true` instead. You'll see the console's own
look and feel against seeded demo data — nothing here is real, and
nothing you do here affects a real backend.

**B. Connect it to your real License Server.** Set `LICENSE_API_URL`
to that server's own URL, including the `/v1` prefix (e.g.
`https://license.example.com/v1`), and `LICENSE_ADMIN_API_KEY` to
that server's own `ADMIN_API_KEY` value — it must match exactly. A
known gotcha: a stray leading/trailing space on either side has caused
a real, confusing `403 Unauthorized` before (`PROJECT_STATUS.md` §60)
even though the two values "look" the same — double-check for
whitespace if you hit that.

## 5. Start it

```bash
docker compose -f docker-compose.selfhosted.yml up -d
```

## 6. Verify it's running

```bash
curl -I http://127.0.0.1:3000/login
```

You should get a `200`. Open `http://127.0.0.1:3000/login` in a
browser (or your reverse proxy's real URL, once you've set one up) and
log in with the `ADMIN_UI_USERNAME`/`ADMIN_UI_PASSWORD` you set in step
3. The footer shows this console's own version and, once connected to
a real backend (option B above), that backend's version too.

## Next steps

- `SELF_HOSTED_DISTRIBUTION_DESIGN.md` in this repo — the design
  record this handout implements, including what's still deliberately
  out of scope (a hard version-compatibility gate, multi-user
  self-hosted accounts, and public distribution).
- Questions? Ask whoever handed you this package.
