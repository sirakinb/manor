import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUILTIN_AGENT_SKILLS, RAKAZO_DOCS_URLS } from "./builtin-skills.js";

const repoFile = (path: string) => new URL(`../../../${path}`, import.meta.url);
const publishedSlugs = [
  ...readFileSync(repoFile("apps/www/src/docs.ts"), "utf8").matchAll(/slug: "([\w-]+)"/g),
].map((match) => match[1]);

describe("Manor skill", () => {
  it("links only to Manor's own published docs", () => {
    const skill = BUILTIN_AGENT_SKILLS.find((s) => s.name === "Manor")!;
    const urls = [...skill.content.matchAll(/https?:\/\/\S+/g)].map((match) => match[0]);
    expect(urls).toEqual(RAKAZO_DOCS_URLS);
    expect(skill.content).not.toContain("Rakazo");
    for (const url of urls) {
      const slug =
        /^https:\/\/raw\.githubusercontent\.com\/sirakinb\/manor\/main\/docs\/([\w-]+)\.md$/.exec(
          url,
        )?.[1];
      expect(publishedSlugs, url).toContain(slug);
      expect(existsSync(repoFile(`docs/${slug}.md`)), url).toBe(true);
    }
  });
});
