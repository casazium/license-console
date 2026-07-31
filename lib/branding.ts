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

/**
 * Reads branding config from env on every call (not cached) so it stays
 * correct if the process env changes between requests in dev. All fields
 * are optional - an unconfigured deployment falls back to the default title,
 * default color, no logo/copyright, and Next's own default favicon.
 */
export function getBranding(): Branding {
  return {
    logoUrl: process.env.BRANDING_LOGO_URL?.trim() || null,
    titleHtml: process.env.BRANDING_TITLE_HTML?.trim() || DEFAULT_TITLE_HTML,
    copyrightHolder: process.env.BRANDING_COPYRIGHT_HOLDER?.trim() || null,
    color: process.env.BRANDING_COLOR?.trim() || DEFAULT_COLOR,
    faviconUrl: process.env.BRANDING_FAVICON_URL?.trim() || null,
  };
}
