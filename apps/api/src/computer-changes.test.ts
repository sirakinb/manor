import { describe, expect, it } from "vitest";
import {
  findGitRepositoriesArgv,
  gitDiffArgv,
  isSafeRepoRelativePath,
  parseGitStatus,
  parseRepositoryList,
  truncateDiff,
} from "./computer-changes.js";

describe("parseRepositoryList", () => {
  it("maps .git directories to repository paths, root included", () => {
    expect(parseRepositoryList("./.git\n./apps/site/.git\n./tools/.git\n")).toEqual([
      "",
      "apps/site",
      "tools",
    ]);
  });

  it("ignores noise lines", () => {
    expect(parseRepositoryList("find: permission denied\n./x/.git\n")).toEqual(["x"]);
  });
});

describe("parseGitStatus", () => {
  it("folds index and worktree columns into one status", () => {
    const out = ["M  src/a.ts", " M src/b.ts", "A  src/c.ts", " D src/d.ts", "?? notes.md"].join(
      "\0",
    );
    expect(parseGitStatus(`${out}\0`)).toEqual([
      { path: "notes.md", status: "untracked" },
      { path: "src/a.ts", status: "modified" },
      { path: "src/b.ts", status: "modified" },
      { path: "src/c.ts", status: "added" },
      { path: "src/d.ts", status: "deleted" },
    ]);
  });

  it("consumes the original path of a rename and flags conflicts", () => {
    const out = "R  new.ts\0old.ts\0UU merge.ts\0";
    expect(parseGitStatus(out)).toEqual([
      { path: "merge.ts", status: "conflict" },
      { path: "new.ts", status: "renamed" },
    ]);
  });

  it("returns nothing for a clean tree", () => {
    expect(parseGitStatus("")).toEqual([]);
  });
});

describe("git argv", () => {
  it("prunes dependency folders while searching for repositories", () => {
    const argv = findGitRepositoriesArgv();
    expect(argv[0]).toBe("find");
    expect(argv).toContain("node_modules");
    expect(argv.slice(-3)).toEqual(["-name", ".git", "-print"]);
  });

  it("diffs untracked files against nothing and tracked files against HEAD", () => {
    expect(gitDiffArgv("untracked", "a.ts")).toEqual([
      "git",
      "diff",
      "--no-index",
      "--",
      "/dev/null",
      "a.ts",
    ]);
    expect(gitDiffArgv("modified", "a.ts")).toEqual(["git", "diff", "HEAD", "--", "a.ts"]);
  });
});

describe("truncateDiff", () => {
  it("cuts at a line boundary and flags it", () => {
    const diff = "line one\nline two\nline three\n";
    expect(truncateDiff(diff, 12)).toEqual({ diff: "line one", truncated: true });
    expect(truncateDiff(diff, 1000)).toEqual({ diff, truncated: false });
  });
});

describe("isSafeRepoRelativePath", () => {
  it("rejects escapes and absolute paths", () => {
    expect(isSafeRepoRelativePath("src/a.ts")).toBe(true);
    expect(isSafeRepoRelativePath("../a.ts")).toBe(false);
    expect(isSafeRepoRelativePath("/etc/passwd")).toBe(false);
    expect(isSafeRepoRelativePath("")).toBe(false);
  });
});
