import type { CSSProperties } from 'react';

// Overrides Mantine Button's own CSS variables so a primary button picks up
// the operator's configured brand color (set on <body> in the root layout,
// see lib/branding.ts) instead of Mantine's default blue - keeps every
// primary action in sync with the login page and title accent without
// duplicating the value. Not applied to destructive actions (Revoke,
// Delete) - those deliberately stay red/neutral regardless of brand color,
// so they keep reading as "dangerous" rather than blending in as just
// another branded button.
export const brandButtonStyle: CSSProperties = {
  '--button-bg': 'var(--brand-color)',
  '--button-hover': 'color-mix(in srgb, var(--brand-color) 85%, black)',
} as CSSProperties;

// For text-only variants (subtle, outline, etc.) whose Mantine-computed
// --button-bg is already transparent at rest - overriding --button-bg like
// brandButtonStyle does above would paint a solid brand-colored background
// behind the text instead of just recoloring it. These variants render
// their color via --button-color, not --button-bg.
export const brandTextButtonStyle: CSSProperties = {
  '--button-color': 'var(--brand-color)',
  '--button-hover-color': 'var(--brand-color)',
} as CSSProperties;
