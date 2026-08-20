export function BrandLogo({
  logoUrl,
  linkUrl,
  size = 36,
}: {
  logoUrl: string | null;
  linkUrl?: string | null;
  size?: number;
}) {
  if (!logoUrl) {
    return null;
  }

  // Plain <img>, not next/image: BRANDING_LOGO_URL can point at any remote
  // host the operator chooses, and next/image would require allowlisting
  // each one in next.config.js ahead of time.
  const image = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logoUrl}
      alt="" // decorative - the adjacent BrandTitle carries the accessible name
      height={size}
      style={{ display: 'block', maxWidth: size * 4, objectFit: 'contain' }}
    />
  );

  // BRANDING_LOGO_LINK_URL - optional, and only meaningful alongside an
  // actual logo (a link with nothing to click looks broken). A genuine
  // cross-origin navigation (the operator's own site, most likely), not
  // an in-app route, so a plain <a>, not next/link - same reasoning as
  // shared/components/Navbar's own logo.href in casazium/casazium.
  if (!linkUrl) {
    return image;
  }

  return (
    <a href={linkUrl} style={{ display: 'block', lineHeight: 0 }}>
      {image}
    </a>
  );
}
