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

# Run as the non-root `node` user this base image already provides, rather
# than root - this server is stateless (no writable data dir needed), so
# --chown on the COPY steps above is sufficient without a separate chown RUN.
USER node

EXPOSE 3000
CMD ["node", "server.js"]
