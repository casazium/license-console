# license-console

Admin console UI for `casazium/license`. See `PROJECT_STATUS.md` for
architecture decisions and scope, and `CLAUDE.md` for session conventions.

## Development

```bash
cp .env.example .env.local
npm install
npm run dev
```

`SESSION_SECRET` and `ADMIN_UI_PASSWORD` are required to sign in locally.
`LICENSE_API_URL` / `LICENSE_ADMIN_API_KEY` aren't consumed by any page yet —
see `PROJECT_STATUS.md` for what's still unwired.
