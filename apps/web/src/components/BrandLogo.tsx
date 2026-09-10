import { brand } from "../lib/brand";

/** Frame supplied artwork without modifying the original image. */
export function BrandLogo({ className }: { className: string }) {
  if (!brand.logo.viewBox)
    return <img src={brand.logo.src} alt={brand.logo.alt} className={className} />;
  return (
    <svg viewBox={brand.logo.viewBox} role="img" aria-label={brand.logo.alt} className={className}>
      <image href={brand.logo.src} width="100" height="100" preserveAspectRatio="none" />
    </svg>
  );
}
