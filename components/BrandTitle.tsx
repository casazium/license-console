import type { CSSProperties } from 'react';

export function BrandTitle({ titleHtml, style }: { titleHtml: string; style?: CSSProperties }) {
  return (
    // titleHtml is operator-controlled config (BRANDING_TITLE_HTML), not
    // user input - dangerouslySetInnerHTML is safe here. Do not reuse this
    // pattern anywhere user input could reach it.
    <div style={{ lineHeight: 1.2, ...style }} dangerouslySetInnerHTML={{ __html: titleHtml }} />
  );
}
