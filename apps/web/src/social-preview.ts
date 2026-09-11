import type { BrandConfig } from "@rakazo/brands";

function escapeAttribute(value: string): string {
  return value.replace(/[&"<>]/g, (character) => {
    return { "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" }[character]!;
  });
}

/** Only trusted brand configuration supplies absolute URLs, never request headers. */
export function renderSocialPreview(html: string, brand: BrandConfig): string {
  const preview = brand.socialPreview;
  if (!preview) return html;
  const origin = `https://${brand.hostnames[0]}`;
  const image = new URL(preview.image, origin).href;
  const values: Record<string, string> = {
    "og:site_name": brand.name,
    "og:title": preview.title,
    "og:url": `${origin}/`,
    "og:image": image,
    "og:image:type": preview.imageType,
    "og:image:width": String(preview.width),
    "og:image:height": String(preview.height),
    "og:image:alt": preview.imageAlt,
    "twitter:title": preview.title,
    "twitter:image": image,
    "twitter:image:alt": preview.imageAlt,
  };
  return html.replace(
    /(<meta\s+(?:property|name)="([^"]+)"\s+content=")[^"]*("\s*\/?>)/g,
    (tag, prefix: string, key: string, suffix: string) =>
      values[key] === undefined ? tag : `${prefix}${escapeAttribute(values[key])}${suffix}`,
  );
}
