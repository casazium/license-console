import { isMultiTenant } from './config';
import { getDb } from './db';

const DEFAULT_TITLE_HTML = 'License Console';

// Mantine's default primary blue (blue.6) - used whenever BRANDING_COLOR is
// unset, so `var(--brand-color)` always resolves to something reasonable
// without requiring operators to write CSS fallback syntax themselves.
const DEFAULT_COLOR = '#228be6';

export type Branding = {
  logoUrl: string | null;
  titleHtml: string;
  // Security review finding L3: true only for the platform/env-var
  // source (BRANDING_TITLE_HTML) - genuinely operator-trusted config,
  // not user input, exactly as BrandTitle.tsx's own comment claims.
  // false whenever titleHtml came from tenant_branding instead - once a
  // settings UI lets a tenant set this themselves (none exists yet;
  // nothing writes that table today), that value must never reach
  // dangerouslySetInnerHTML. Carried on the data itself, not left to
  // every call site to remember, so a future render path gets this
  // right by construction.
  titleIsHtml: boolean;
  copyrightHolder: string | null;
  color: string;
  faviconUrl: string | null;
};

// Strips a single layer of wrapping quotes. .env-file syntax (dotenv) needs
// BRANDING_COLOR="#2563eb" quoted so the # isn't parsed as a comment, but
// platform env-var UIs (Coolify, Docker, etc.) take the field value
// literally with no shell/dotenv-style quote stripping - pasting that same
// quoted example into one of those UIs sends the quote characters through
// as part of the value. --brand-color then holds a CSS <string> instead of
// a <color>, which makes every var(--brand-color) substitution invalid at
// computed-value time - background-color silently falls back to
// transparent, rendering white-on-transparent buttons invisible. Stripping
// the quotes here makes both input styles work.
function unwrapQuotes(value: string): string {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Reads branding config from env on every call (not cached) so it stays
 * correct if the process env changes between requests in dev. All fields
 * are optional - an unconfigured deployment falls back to the default title,
 * default color, no logo/copyright, and Next's own default favicon.
 */
function getPlatformBranding(): Branding {
  const rawColor = process.env.BRANDING_COLOR?.trim();

  return {
    logoUrl: process.env.BRANDING_LOGO_URL?.trim() || null,
    titleHtml: process.env.BRANDING_TITLE_HTML?.trim() || DEFAULT_TITLE_HTML,
    titleIsHtml: true,
    copyrightHolder: process.env.BRANDING_COPYRIGHT_HOLDER?.trim() || null,
    color: rawColor ? unwrapQuotes(rawColor) : DEFAULT_COLOR,
    faviconUrl: process.env.BRANDING_FAVICON_URL?.trim() || null,
  };
}

type TenantBrandingRow = {
  logo_url: string | null;
  title_html: string | null;
  copyright_holder: string | null;
  color: string | null;
  favicon_url: string | null;
};

/**
 * SaaS-B3. `tenantId` is only meaningful under MULTI_TENANT, and only
 * once a session exists - pre-auth pages (/login, /signup) have no
 * tenant to look up yet and always get the env-var/platform branding,
 * same as self-hosted always does (see app/layout.tsx's session peek
 * for where that split actually happens). Falls back field-by-field to
 * the platform default, not row-absent-or-not: a tenant can override
 * just BRANDING_COLOR via a future settings UI without needing to also
 * supply a logo. Nothing writes tenant_branding yet - no task in the
 * current plan owns building that settings page - so in practice every
 * lookup here returns the platform default today; the resolution logic
 * itself is what this task is responsible for.
 */
export function getBranding(tenantId?: string): Branding {
  const platform = getPlatformBranding();

  if (!tenantId || !isMultiTenant()) {
    return platform;
  }

  const row = getDb()
    .prepare(
      'SELECT logo_url, title_html, copyright_holder, color, favicon_url FROM tenant_branding WHERE tenant_id = ?'
    )
    .get(tenantId) as TenantBrandingRow | undefined;

  if (!row) {
    return platform;
  }

  const tenantTitle = row.title_html?.trim();

  return {
    logoUrl: row.logo_url?.trim() || platform.logoUrl,
    titleHtml: tenantTitle || platform.titleHtml,
    // false whenever the tenant's own value is actually used - see the
    // Branding type's own comment above. Falls back to the platform
    // value's trust level, not a blanket false, when there's no tenant
    // override to apply.
    titleIsHtml: tenantTitle ? false : platform.titleIsHtml,
    copyrightHolder: row.copyright_holder?.trim() || platform.copyrightHolder,
    // No unwrapQuotes() here, unlike the platform/env path above - a
    // DB-stored value came from a settings form (once one exists), not
    // a dotenv/platform-env-var-UI pipeline, so that quoting quirk
    // doesn't apply to it.
    color: row.color?.trim() || platform.color,
    faviconUrl: row.favicon_url?.trim() || platform.faviconUrl,
  };
}
