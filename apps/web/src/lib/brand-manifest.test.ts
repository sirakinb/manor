import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { brands } from "@rakazo/brands";
import { describe, expect, it } from "vitest";

// applyBrand points a portal's manifest link at /brands/<id>/site.webmanifest; the build
// generates only Manor's own /site.webmanifest, so every other brand must ship its file.
describe("brand portal web manifests", () => {
  it.each(brands.filter((brand) => brand.id !== "manor").map((brand) => [brand.id]))(
    "%s ships a manifest naming its own icons",
    (id) => {
      const path = fileURLToPath(
        new URL(`../../public/brands/${id}/site.webmanifest`, import.meta.url),
      );
      expect(existsSync(path)).toBe(true);
      const manifest = JSON.parse(readFileSync(path, "utf8")) as {
        name?: string;
        icons?: { src: string }[];
      };
      expect(manifest.name).toBeTruthy();
      expect(manifest.icons?.length).toBeGreaterThan(0);
      for (const icon of manifest.icons ?? []) {
        expect(icon.src.startsWith(`/brands/${id}/`)).toBe(true);
        const file = fileURLToPath(new URL(`../../public${icon.src}`, import.meta.url));
        expect(existsSync(file)).toBe(true);
      }
    },
  );
});
