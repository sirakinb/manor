import { type BrandConfig, brandById, resolveBrand } from "@rakazo/brands";
import { tokens } from "@rakazo/ui-tokens";

const OVERRIDE_KEY = "rk-brand-override";

function activeBrand(): BrandConfig {
  if (import.meta.env.DEV) {
    const param = new URLSearchParams(window.location.search).get("__brand");
    if (param !== null) {
      if (param && brandById(param)) window.localStorage.setItem(OVERRIDE_KEY, param);
      else window.localStorage.removeItem(OVERRIDE_KEY);
    }
    const stored = window.localStorage.getItem(OVERRIDE_KEY);
    if (stored) {
      const found = brandById(stored);
      if (found) return found;
    }
  }
  return resolveBrand(window.location.hostname);
}

export const brand = activeBrand();

/** Simple identifier for interpolation inside Lingui macros. */
export const brandName = brand.name;

/** For JS-side color needs (SVG attributes, chart palettes). */
export const accentColor = brand.colors.accent ?? tokens.accent;

function hexToHsl(hex: string): string | undefined {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return undefined;
  const value = Number.parseInt(match[1] ?? "", 16);
  const r = ((value >> 16) & 255) / 255;
  const g = ((value >> 8) & 255) / 255;
  const b = (value & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

function setLink(rel: string, href: string, type?: string) {
  for (const link of document.querySelectorAll<HTMLLinkElement>(`link[rel="${rel}"]`))
    link.remove();
  const link = document.createElement("link");
  link.rel = rel;
  link.href = href;
  if (type) link.type = type;
  document.head.appendChild(link);
}

/** Applies the resolved brand before first paint. A no-op for the default brand. */
export function applyBrand() {
  const root = document.documentElement;
  root.dataset.brand = brand.id;
  for (const [token, color] of Object.entries(brand.colors)) {
    root.style.setProperty(`--rk-${token}`, color);
  }
  if (brand.colors.accent) {
    root.style.setProperty("--bui-accent", brand.colors.accent);
    const hsl = hexToHsl(brand.colors.accent);
    if (hsl) {
      root.style.setProperty("--primary", hsl);
      root.style.setProperty("--ring", hsl);
    }
  }
  if (brand.id === "manor") return;
  document.title = brand.title;
  document
    .querySelector('meta[name="apple-mobile-web-app-title"]')
    ?.setAttribute("content", brand.title);
  if (brand.colors.page) {
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", brand.colors.page);
  }
  setLink("icon", brand.favicon, "image/png");
  setLink("apple-touch-icon", brand.appleTouchIcon);
  setLink("manifest", `/brands/${brand.id}/site.webmanifest`);
}
