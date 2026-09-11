import { readFileSync } from "node:fs";
import { brandById, defaultBrand } from "@rakazo/brands";
import { describe, expect, it } from "vitest";
import { renderSocialPreview } from "./social-preview";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

describe("social preview HTML", () => {
  it("preserves the default document and application bootstrap", () => {
    expect(renderSocialPreview(html, defaultBrand)).toBe(html);
    const branded = renderSocialPreview(html, brandById("vibecodephilly")!);
    expect(branded).toContain('<script type="module" src="/src/main.tsx"></script>');
    expect(branded).toContain('name="twitter:card" content="summary_large_image"');
    expect(branded).not.toContain("manor-social-card");
  });

  it("escapes configured metadata without introducing HTML", () => {
    const brand = brandById("vibecodephilly")!;
    const branded = renderSocialPreview(html, {
      ...brand,
      socialPreview: { ...brand.socialPreview!, title: 'A & B "<example>"' },
    });
    expect(branded).toContain('content="A &amp; B &quot;&lt;example&gt;&quot;"');
    expect(branded).not.toContain('"<example>"');
  });
});
