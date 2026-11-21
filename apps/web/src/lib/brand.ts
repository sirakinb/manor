import { type BrandConfig, brandById, resolveBrand } from "@rakazo/brands";
import { tokens } from "@rakazo/ui-tokens";
import { brandThemeVariables } from "./brand-theme";

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
  for (const [name, value] of Object.entries(brandThemeVariables(brand.colors))) {
    root.style.setProperty(name, value);
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
