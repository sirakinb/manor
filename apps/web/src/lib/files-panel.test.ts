import { describe, expect, it } from "vitest";
import {
  baseName,
  breadcrumbs,
  classifyDiffLine,
  formatBytes,
  joinPath,
  looksBinary,
  parentPath,
  sortEntries,
} from "./files-panel.js";

describe("files panel paths", () => {
  it("sorts directories first, then names case-insensitively", () => {
    const sorted = sortEntries([
      { path: "b.ts", kind: "file", size: 1 },
      { path: "src", kind: "dir", size: 0 },
      { path: "A.ts", kind: "file", size: 1 },
      { path: "Docs", kind: "dir", size: 0 },
    ]);
    expect(sorted.map((entry) => entry.path)).toEqual(["Docs", "src", "A.ts", "b.ts"]);
  });

  it("splits and joins workspace paths", () => {
    expect(baseName("apps/web/index.ts")).toBe("index.ts");
    expect(parentPath("apps/web/index.ts")).toBe("apps/web");
    expect(parentPath("index.ts")).toBe("");
    expect(joinPath("", "apps")).toBe("apps");
    expect(joinPath("apps/", "web")).toBe("apps/web");
  });

  it("builds breadcrumbs from the root", () => {
    expect(breadcrumbs("apps/web", "Home")).toEqual([
      { label: "Home", path: "" },
      { label: "apps", path: "apps" },
      { label: "web", path: "apps/web" },
    ]);
  });

  it("formats sizes and spots binaries by extension", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
    expect(looksBinary("hero.PNG")).toBe(true);
    expect(looksBinary("README")).toBe(false);
    expect(looksBinary("index.ts")).toBe(false);
  });
});

describe("classifyDiffLine", () => {
  it("separates additions, deletions, hunks, and headers", () => {
    expect(classifyDiffLine("+++ b/a.ts")).toBe("meta");
    expect(classifyDiffLine("--- a/a.ts")).toBe("meta");
    expect(classifyDiffLine("diff --git a/a b/a")).toBe("meta");
    expect(classifyDiffLine("@@ -1,2 +1,3 @@")).toBe("hunk");
    expect(classifyDiffLine("+const a = 1;")).toBe("add");
    expect(classifyDiffLine("-const a = 0;")).toBe("del");
    expect(classifyDiffLine(" unchanged")).toBe("context");
  });
});
