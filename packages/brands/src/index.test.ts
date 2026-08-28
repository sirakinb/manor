import { describe, expect, it } from "vitest";
import { brandHostnames, brandOrigins, brands, defaultBrand, resolveBrand } from "./index.js";

describe("brand registry", () => {
  it("resolves each brand by every hostname it claims", () => {
    for (const brand of brands) {
      for (const hostname of brand.hostnames) {
        expect(resolveBrand(hostname).id).toBe(brand.id);
        expect(resolveBrand(hostname.toUpperCase()).id).toBe(brand.id);
      }
    }
  });

  it("falls back to Manor for unknown hosts (localhost, previews)", () => {
    expect(resolveBrand("localhost").id).toBe(defaultBrand.id);
    expect(resolveBrand("127.0.0.1").id).toBe(defaultBrand.id);
    expect(resolveBrand("unknown.example.com").id).toBe("manor");
  });

  it("keeps hostnames unique across brands", () => {
    const all = brandHostnames();
    expect(new Set(all).size).toBe(all.length);
  });

  it("keeps the Manor default free of color overrides", () => {
    expect(defaultBrand.colors).toEqual({});
  });

  it("only overrides known ui-token names", async () => {
    const { tokens } = await import("@rakazo/ui-tokens");
    const known = new Set(
      Object.keys(tokens).map((key) =>
        key
          .replace(/([a-z])([A-Z])/g, "$1-$2")
          .replace(/([a-z])(\d)/g, "$1-$2")
          .toLowerCase(),
      ),
    );
    for (const brand of brands) {
      for (const key of Object.keys(brand.colors)) {
        expect(known, `${brand.id} overrides unknown token "${key}"`).toContain(key);
      }
    }
  });

  it("emits https origins for every hostname", () => {
    expect(brandOrigins()).toContain("https://jrhmanor.agentworkspace.cloud");
    expect(brandOrigins()).toContain("https://manor.pentridgemedia.com");
  });
});
