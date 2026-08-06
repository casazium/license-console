import type { CSSProperties } from 'react';

/**
 * Security review finding L3: `dangerouslySetInnerHTML` only fires when
 * the caller explicitly asserts `isHtml` - true for the platform/env-var
 * source (BRANDING_TITLE_HTML, genuinely operator-trusted config, not
 * user input), false for anything sourced from `tenant_branding`
 * (lib/branding.ts's own `Branding.titleIsHtml`), which renders as
 * plain text instead. Do not pass `isHtml={true}` for any value that
 * didn't come from that trusted platform-config path.
 */
export function BrandTitle({
  titleHtml,
  isHtml,
  style,
}: {
  titleHtml: string;
  isHtml: boolean;
  style?: CSSProperties;
}) {
  if (!isHtml) {
    return (
      <div style={{ lineHeight: 1.2, ...style }}>{titleHtml}</div>
    );
  }
  return <div style={{ lineHeight: 1.2, ...style }} dangerouslySetInnerHTML={{ __html: titleHtml }} />;
}
