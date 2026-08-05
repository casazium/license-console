import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// style-src needs 'unsafe-inline' - Mantine injects style attributes/tags
// at runtime, not just external stylesheets. script-src also needs
// 'unsafe-inline' - verified empirically that without it, Next's own inline
// hydration/bootstrap scripts are blocked and the app never becomes
// interactive (login hangs forever). A fully strict script-src needs
// per-request nonces wired through middleware and every page - a much
// larger change than this pass; 'unsafe-inline' here still blocks arbitrary
// third-party script/object/frame sources and clickjacking, which is the
// bulk of what was missing (no CSP at all). img-src allows any https:
// source (plus data: for inlined assets) because BRANDING_LOGO_URL and
// BRANDING_FAVICON_URL are operator-configured and may point anywhere -
// restricting this would break legitimate branding config, not attackers.
// Next's dev server (Fast Refresh, dev-mode stack traces) calls eval() to
// do its job - blocking it doesn't harden anything locally, it just breaks
// the dev server. Next never calls eval() in a production build, so
// 'unsafe-eval' is scoped out there, where it'd actually be a real
// loosening of the policy.
const scriptSrc =
  process.env.NODE_ENV === 'production'
    ? "script-src 'self' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";

const CSP = [
  "default-src 'self'",
  scriptSrc,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https: data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

// APP_VERSION/GIT_SHA are computed once here, at build time, not read at
// request time - the Docker runner stage never has .git (only .next/
// standalone, public/, and .next/static are copied into it, see
// Dockerfile), so this has to happen during `next build` in the builder
// stage, while the full build context (including .git, via `COPY . .`) is
// still present. execSync failing (e.g. building from a context without
// .git) falls back to 'unknown' rather than failing the build - a missing
// version stamp shouldn't block a deploy.
function getGitSha() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: import.meta.dirname }).toString().trim();
  } catch {
    return 'unknown';
  }
}

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Produces a self-contained .next/standalone build (server.js + only the
  // node_modules actually used) - keeps the Docker image small instead of
  // shipping the full node_modules tree. Required by Dockerfile.
  output: 'standalone',

  // better-sqlite3 (lib/db.ts, SaaS-B1a) is a native addon (a compiled
  // .node binary, not pure JS) - left external so Next's bundler doesn't
  // try to webpack it, which would either fail the build or silently
  // produce a broken bundle that can't load the binary at runtime. The
  // standalone output tracer still includes the package's own files
  // (its node_modules subset) since it's a real dependency, just unbundled.
  serverExternalPackages: ['better-sqlite3'],

  env: {
    APP_VERSION: pkg.version,
    GIT_SHA: getGitSha(),
  },

  async headers() {
    return [
      {
        // Applies to every route, including the pre-auth /login page - an
        // admin console with destructive one-click actions (revoke,
        // delete) has no business being frameable from anywhere.
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Content-Security-Policy', value: CSP },
        ],
      },
    ];
  },
};

export default nextConfig;
