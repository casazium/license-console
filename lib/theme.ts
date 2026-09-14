// lib/theme.ts
//
// Applies casazium.com's 2026-09 redesign (design/casazium-homepage-handoff
// in casazium/casazium - not this repo, read-only reference) to this
// console's default Mantine look, so the console doesn't feel like a
// different product from the marketing site and docs it sits behind.
//
// This themes Mantine rather than replacing it - same component APIs,
// new tokens - which is the lowest-risk way to apply the redesign's
// "restraint over decoration" principle (no shadows, no color, sharp
// small radii) without a rewrite. Values are copied by hand from
// casazium/casazium's shared/styles/shell.css (the one file that repo
// treats as the canonical token source for its own two surfaces,
// website + docs) since this is a separate repo with no shared build -
// keep the two in step the same way that repo's own website/
// tailwind.config.cjs already has to.
//
// Deliberately does NOT touch lib/branding.ts's tenant/operator
// white-label override mechanism (BRANDING_COLOR, BRANDING_LOGO_URL,
// etc.) - this theme is the *default* look, not a replacement for it.
import { createTheme } from '@mantine/core';

export const theme = createTheme({
  fontFamily: '"IBM Plex Sans", Helvetica, Arial, sans-serif',
  fontFamilyMonospace: '"IBM Plex Mono", monospace',
  headings: {
    fontFamily: '"IBM Plex Sans", Helvetica, Arial, sans-serif',
    fontWeight: '600',
  },

  // A monotonic light-to-dark ramp anchored so shade 6 (Mantine's own
  // default primaryShade for the light color scheme) lands exactly on
  // the design system's --cz-ink (#16150f) - so `color="ink"` at its
  // default shade always resolves to real ink, not an approximation.
  // Not a semantic 10-step palette in its own right (this is a
  // monochrome design with a handful of named greys, not a hue scale) -
  // just enough of a ramp for Mantine's own hover/light-variant shade
  // math to have somewhere to land.
  colors: {
    ink: [
      '#f7f6f3', // --cz-paper
      '#f2f0ec', // --cz-paper-2
      '#e0ded7', // --cz-rule
      '#c9c6bb', // --cz-rule-strong
      '#a5a294', // --cz-on-dark-3 (used here only as a mid-grey step)
      '#6b6858', // --cz-muted
      '#16150f', // --cz-ink - the real color, and the default shade
      '#100f0b',
      '#0b0a08',
      '#050504',
    ],
  },
  primaryColor: 'ink',
  primaryShade: { light: 6, dark: 6 },

  // Card radius 6px, button radius 4px, chip radius 3px per
  // DESIGN-SYSTEM.md's Layout section - remapped onto Mantine's own
  // xs/sm/md scale rather than left at Mantine's defaults (xs 2 / sm 4 /
  // md 8 / lg 16 / xl 32), so component defaultProps below can just say
  // "sm" or "md" and get the spec's actual pixel values.
  radius: {
    xs: '3px',
    sm: '4px',
    md: '6px',
    lg: '8px',
    xl: '12px',
  },
  defaultRadius: 'sm',

  // "No shadows anywhere. Depth is one hairline and two tints."
  // (DESIGN-SYSTEM.md, Layout) - zeroed at the theme level so anything
  // that defaults to theme.shadows.* (Card, Menu, Modal, ...) inherits
  // the flat look without a per-component override.
  shadows: {
    xs: 'none',
    sm: 'none',
    md: 'none',
    lg: 'none',
    xl: 'none',
  },

  components: {
    Button: {
      defaultProps: {
        radius: 'sm',
      },
      styles: {
        // Metrics from DESIGN-SYSTEM.md's Components section: "13px 22px,
        // 4px radius, weight 500, white-space: nowrap. No transform, no
        // shadow, no scale on hover. Transitions <=150ms or none."
        root: {
          fontWeight: 500,
          whiteSpace: 'nowrap',
          transitionDuration: '150ms',
          transitionProperty: 'color, background-color, border-color',
        },
      },
    },
    Card: {
      defaultProps: {
        radius: 'md',
        withBorder: true,
        shadow: 'none',
      },
      styles: {
        // Mantine's own withBorder color (theme.colors.gray[3], ~#dee2e6)
        // is close to but not exactly --cz-rule (#e0ded7) - close enough
        // to go unnoticed on its own, but every OTHER hairline on this
        // console (once the app-shell/billing work happens) will use the
        // real token, so this one is set explicitly rather than left to
        // drift from them by a few hex digits.
        root: { borderColor: 'var(--cz-rule)' },
      },
    },
    Paper: {
      defaultProps: {
        radius: 'md',
        shadow: 'none',
      },
    },
  },
});
