# Matches .nvmrc (22). Alpine to keep the image small, same choice as a
# typical Next.js standalone Docker setup.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# LICENSE_API_URL/LICENSE_ADMIN_API_KEY are not needed at build time - only
# read server-side at request time (lib/license-client.ts) - so the build
# doesn't need real backend config, standalone or connected.
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# .next/standalone/server.js binds to `process.env.HOSTNAME || '0.0.0.0'` -
# but Docker automatically sets HOSTNAME to the container's own short ID
# for every container, so that fallback never actually triggers. Left
# unset, the server ends up bound to that container-ID hostname instead of
# all interfaces, which the healthcheck below (and any external routing to
# 127.0.0.1/the container's real IP) can't necessarily reach. Confirmed
# directly: reproduced the exact "Local: http://<container-id>:3000" log
# line and an unreachable 127.0.0.1 with HOSTNAME set to a container-ID-like
# value; setting it to 0.0.0.0 here fixes both.
ENV HOSTNAME=0.0.0.0

# Standalone output (next.config.mjs: output: 'standalone') only includes
# the server bundle and the node_modules subset it actually needs - public/
# and .next/static aren't part of it and must be copied separately.
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
# scripts/backup-db.mjs (beta-readiness finding): not part of the Next
# standalone trace (it's not imported by the app itself) so needs an
# explicit copy, same gap as casazium/license's own Dockerfile had.
# better-sqlite3 itself is already present in the standalone node_modules
# subset above - lib/db.ts imports it at runtime, so Next's tracer already
# includes it.
COPY --from=builder --chown=node:node /app/scripts/backup-db.mjs ./scripts/backup-db.mjs
# scripts/backup-and-push.sh: chained backup + off-box B2 push, invoked
# as a single file (not an inline Coolify Scheduled Task command) since
# Coolify's command field did not reliably execute a `&&`-chained,
# quoted command - see the script's own header comment.
COPY --from=builder --chown=node:node /app/scripts/backup-and-push.sh ./scripts/backup-and-push.sh
RUN chmod +x ./scripts/backup-and-push.sh

# rclone (off-box backup push, beta-readiness follow-up, same as
# casazium/license's own Dockerfile): runs from inside this container via
# a Coolify Scheduled Task. No config file baked in; the B2 key/secret are
# read from the blazeKeyID/blazeLicenseServerAppKey environment variables
# Coolify injects, referenced directly on the Scheduled Task's command line.
RUN apk add --no-cache rclone

# Run as the non-root `node` user this base image already provides, rather
# than root. /app/data and /app/backups must be chowned ahead of time so
# the named volumes Coolify mounts there (docker-compose-coolify.yml,
# SaaS-B1a's SQLite file) inherit writable ownership on first creation -
# same reasoning and same pattern as casazium/license's own Dockerfile.
RUN mkdir -p /app/data /app/backups && chown -R node:node /app
USER node

EXPOSE 3000
CMD ["node", "server.js"]
