import { brands } from "@rakazo/brands";
import { describe, expect, it } from "vitest";
import { brandThemeVariables, readableOn } from "./brand-theme";

function brandColors(id: string) {
  const found = brands.find((brand) => brand.id === id);
  if (!found) throw new Error(`unknown brand ${id}`);
  return found.colors;
}

describe("brand theme variables", () => {
  it("leaves the default brand on the shared tokens", () => {
    expect(brandThemeVariables(brandColors("manor"))).toEqual({});
  });

  it("sets the accent as plain colors the shared UI can read directly", () => {
    const variables = brandThemeVariables(brandColors("jrh"));
    expect(variables["--primary"]).toBe("#1f8a8a");
    expect(variables["--ring"]).toBe("#1f8a8a");
    expect(variables["--bui-accent"]).toBe("#1f8a8a");
    expect(variables["--primary-foreground"]).toBe("#ffffff");
  });

  it("keeps publishing every brand color as its --rk- variable", () => {
    const colors = brandColors("jrh");
    const variables = brandThemeVariables(colors);
    for (const [token, color] of Object.entries(colors)) {
      expect(variables[`--rk-${token}`]).toBe(color);
    }
  });

  it("does not tint shared surfaces", () => {
    for (const brand of brands) {
      const names = Object.keys(brandThemeVariables(brand.colors));
      for (const surface of ["--background", "--card", "--popover", "--sidebar", "--border"]) {
        expect(names).not.toContain(surface);
      }
    }
  });

  it("only produces values a color property accepts", () => {
    for (const brand of brands) {
      for (const value of Object.values(brandThemeVariables(brand.colors))) {
        expect(value).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it("picks dark text for an accent that white cannot be read on", () => {
    expect(readableOn("#e9bd38")).toBe("#1a1a1a");
    expect(readableOn("#ff2468")).toBe("#ffffff");
    expect(readableOn("#a855f7")).toBe("#ffffff");
    expect(readableOn("not a color")).toBe("#ffffff");
  });
});
