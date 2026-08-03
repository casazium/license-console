const DEFAULT_TITLE_HTML = 'License Console';

// Mantine's default primary blue (blue.6) - used whenever BRANDING_COLOR is
// unset, so `var(--brand-color)` always resolves to something reasonable
// without requiring operators to write CSS fallback syntax themselves.
const DEFAULT_COLOR = '#228be6';

export type Branding = {
  logoUrl: string | null;
  titleHtml: string;
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
export function getBranding(): Branding {
  const rawColor = process.env.BRANDING_COLOR?.trim();

  return {
    logoUrl: process.env.BRANDING_LOGO_URL?.trim() || null,
    titleHtml: process.env.BRANDING_TITLE_HTML?.trim() || DEFAULT_TITLE_HTML,
    copyrightHolder: process.env.BRANDING_COPYRIGHT_HOLDER?.trim() || null,
    color: rawColor ? unwrapQuotes(rawColor) : DEFAULT_COLOR,
    faviconUrl: process.env.BRANDING_FAVICON_URL?.trim() || null,
  };
}
