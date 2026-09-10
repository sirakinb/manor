import { jrh } from "./clients/jrh.js";
import { manor } from "./clients/manor.js";
import { meridian } from "./clients/meridian.js";
import { vibecodephilly } from "./clients/vibecodephilly.js";

/**
 * A white-label client brand. Colors override the matching `--rk-*` custom
 * properties from @rakazo/ui-tokens; anything omitted keeps the Manor default.
 */
export interface BrandConfig {
  id: string;
  /** Product name shown in UI copy ("Sign in to <name>"). */
  name: string;
  /** Browser tab / PWA title. */
  title: string;
  /** Hostnames that resolve to this brand. */
  hostnames: string[];
  /** Overrides keyed by ui-token name (kebab-case, no `--rk-` prefix). */
  colors: Record<string, string>;
  /** `wide` marks a full-wordmark logo that replaces the name text next to it. */
  logo: { src: string; alt: string; wide?: boolean; viewBox?: string };
  favicon: string;
  appleTouchIcon: string;
  icon192: string;
  icon512: string;
}

export const brands: readonly BrandConfig[] = [manor, jrh, meridian, vibecodephilly];

export const defaultBrand: BrandConfig = manor;

export function resolveBrand(hostname: string): BrandConfig {
  const wanted = hostname.trim().toLowerCase();
  return brands.find((brand) => brand.hostnames.includes(wanted)) ?? defaultBrand;
}

export function brandById(id: string): BrandConfig | undefined {
  return brands.find((brand) => brand.id === id);
}

/** Every brand hostname, for server allowed-host lists. */
export function brandHostnames(): string[] {
  return brands.flatMap((brand) => brand.hostnames);
}

/** HTTPS origins for every brand hostname, for auth trusted-origin lists. */
export function brandOrigins(): string[] {
  return brandHostnames().map((hostname) => `https://${hostname}`);
}
