# license-console

Admin console UI for `casazium/license`. See `PROJECT_STATUS.md` for
architecture decisions and scope, and `CLAUDE.md` for session conventions.

## Development

```bash
cp .env.example .env.local
npm install
npm run dev
```

`SESSION_SECRET`, `ADMIN_UI_USERNAME`, and `ADMIN_UI_PASSWORD` are required to
sign in locally.

`LICENSE_API_URL` / `LICENSE_ADMIN_API_KEY` connect the console to a real
`casazium/license` server (both must be set together). Leave both unset for
standalone mode — an in-memory mock with seeded demo data, the default in
`npm run dev` with no `.env` at all. In production, standalone mode also
requires `LICENSE_STANDALONE_MODE=true`, so an operator who meant to
configure live mode but left it unset fails loudly instead of silently
serving mock data. See `.env.example` for the full rationale on each var,
and `PROJECT_STATUS.md` for architecture decisions.
