export function BrandLogo({ logoUrl, size = 36 }: { logoUrl: string | null; size?: number }) {
  if (!logoUrl) {
    return null;
  }

  // Plain <img>, not next/image: BRANDING_LOGO_URL can point at any remote
  // host the operator chooses, and next/image would require allowlisting
  // each one in next.config.js ahead of time.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logoUrl}
      alt="" // decorative - the adjacent BrandTitle carries the accessible name
      height={size}
      style={{ display: 'block', maxWidth: size * 4, objectFit: 'contain' }}
    />
  );
}
