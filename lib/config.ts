/**
 * SaaS tier feature flag (SaaS-B1b), mirroring casazium/license's own
 * MULTI_TENANT flag (that repo's lib/config.js) - same name, same
 * default-false-for-self-hosted intent, kept as a plain function reading
 * process.env live rather than a cached module-level constant for the
 * same reason that repo's own comment gives: safe for a future test
 * suite to flip per-file without fighting module-load-order caching.
 *
 * Off (the default): lib/auth.ts's verifyCredentials() stays exactly the
 * single static ADMIN_UI_USERNAME/ADMIN_UI_PASSWORD pair it is today -
 * self-hosted deployments never touch the accounts table or signup flow
 * at all. On: it checks the accounts table instead, and /signup becomes
 * reachable.
 */
export function isMultiTenant(): boolean {
  return process.env.MULTI_TENANT === 'true';
}

/**
 * How many hops of X-Forwarded-For, counted from the right, were
 * appended by our own trusted proxy chain (lib/login-rate-limit.ts's
 * getClientIp - security review finding H1-B). Defaults to 1: Coolify's
 * Traefik is the sole path in for this service in every deployment this
 * repo documents today (docker-compose-coolify.yml's `expose:` rather
 * than `ports:`). Only needs changing if a deployment adds another
 * proxy hop in front of Traefik.
 */
export function trustedProxyCount(): number {
  const raw = process.env.TRUSTED_PROXY_COUNT;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

/**
 * The real, public origin to build outbound links from - every emailed
 * link (signup confirmation, password reset) and every redirect target
 * built from a request's own origin (security review finding H2). Next
 * pins a route handler's `request.nextUrl.origin` to the server's
 * *configured* hostname/port, not any request header - in the shipped
 * Docker image that's literally `http://0.0.0.0:3000` (Dockerfile sets
 * HOSTNAME=0.0.0.0, PORT is unset), an address a client can never reach.
 * Confirmed: every emailed reset/confirmation link was unusable in the
 * documented deployment despite this behaving correctly under `next dev`,
 * where fetchHostname resolves to `localhost` instead.
 *
 * Required in production - fails loud rather than silently emailing
 * broken links, matching this codebase's own convention (see
 * lib/license-client.ts's LICENSE_STANDALONE_MODE check). Falls back to
 * the request's own origin in development, where it happens to be
 * correct, so `npm run dev` keeps working with no .env at all.
 */
export function publicBaseUrl(request: { nextUrl: { origin: string } }): string {
  const configured = process.env.PUBLIC_BASE_URL;
  if (configured) {
    return configured.replace(/\/+$/, '');
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'PUBLIC_BASE_URL is unset in a production build. Links this console emails or redirects ' +
        "to are otherwise built from the request's own resolved origin, which - per Next's own " +
        'hostname pinning, not a header - is the literal HOSTNAME/PORT the server was started ' +
        'with (http://0.0.0.0:3000 in the shipped Docker image), not a reachable public address. ' +
        'Set PUBLIC_BASE_URL to the real public origin (e.g. https://console.example.com).'
    );
  }
  return request.nextUrl.origin;
}

/**
 * Origin check for the two Route Handlers a CSRF-style cross-site
 * request can actually do real damage through (security review
 * finding, fresh pre-deployment audit): Next's own built-in CSRF
 * protection for Server Actions does not extend to plain Route
 * Handlers, and `Request.json()` parses the body as JSON regardless of
 * the request's declared `Content-Type` - so a cross-site
 * `<form enctype="text/plain">` reaches these routes without a CORS
 * preflight ever running (`text/plain` is one of fetch's "simple"
 * content types). Confirmed live: `POST /api/login` with
 * `Content-Type: text/plain` and a cross-site `Origin` succeeded and
 * set the session cookie - a victim's browser could be silently logged
 * into an attacker-controlled tenant, with anything they then typed
 * (customer names, license notes) landing in the attacker's own
 * account. Every *other* cookie-bearing route (`/api/logout`,
 * `/api/verify-email/resend`) is already protected by this app's own
 * `SameSite=lax` session cookie - a cross-site request simply doesn't
 * carry it, so there's no existing session for a forged request to
 * ride on. Login and signup are different precisely because they don't
 * require a cookie to begin with - they're what *creates* one.
 *
 * Compares the real `Origin` header (a browser-controlled header no
 * client-side JS can override) against this deployment's own
 * `publicBaseUrl()` - not `request.headers.get('host')`, which an
 * attacker's own request can set to anything. Fails closed: a missing
 * or mismatched `Origin` is rejected, matching how Next's own Server
 * Action protection behaves.
 */
export function isSameOrigin(request: {
  headers: { get(name: string): string | null };
  nextUrl: { origin: string };
}): boolean {
  const origin = request.headers.get('origin');
  if (!origin) {
    return false;
  }
  return origin === publicBaseUrl(request);
}
