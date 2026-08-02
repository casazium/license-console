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
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https: data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Produces a self-contained .next/standalone build (server.js + only the
  // node_modules actually used) - keeps the Docker image small instead of
  // shipping the full node_modules tree. Required by Dockerfile.
  output: 'standalone',

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
