import type { AdapterContext, ComputerRef, SandboxProvider } from "@rakazo/adapter-kit";
import type { WorkspaceChangeStatus } from "@rakazo/contracts";

export type WorkspaceChange = { path: string; status: WorkspaceChangeStatus };
export type WorkspaceRepo = { path: string; files: WorkspaceChange[] };

export const MAX_DIFF_BYTES = 200 * 1024;
const COMMAND_TIMEOUT_MS = 20_000;
/** Directories that are never project roots and are expensive to walk. */
const SKIPPED_DIRECTORIES = ["node_modules", ".cache", ".npm", ".pnpm-store", ".browser-profiles"];

export async function runInComputer(
  sandbox: Pick<SandboxProvider, "execute">,
  computer: ComputerRef,
  argv: string[],
  cwd: string | undefined,
  context: AdapterContext,
): Promise<{ stdout: string; stderr: string; code: number }> {
  let stdout = "";
  let stderr = "";
  let code = 0;
  for await (const event of sandbox.execute(
    computer,
    { argv, cwd, timeoutMs: COMMAND_TIMEOUT_MS },
    context,
  )) {
    if (event.type === "stdout") stdout += event.data;
    else if (event.type === "stderr") stderr += event.data;
    else code = event.code;
  }
  return { stdout, stderr, code };
}

/** `find` output listing every `.git` directory under the workspace, shallow enough to stay cheap. */
export function findGitRepositoriesArgv(): string[] {
  const prune = SKIPPED_DIRECTORIES.flatMap((name, index) =>
    index === 0 ? ["-name", name] : ["-o", "-name", name],
  );
  return [
    "find",
    ".",
    "-maxdepth",
    "4",
    "(",
    ...prune,
    ")",
    "-prune",
    "-o",
    "-name",
    ".git",
    "-print",
  ];
}

/** Repository paths relative to the workspace root, "" for the root itself, sorted. */
export function parseRepositoryList(stdout: string): string[] {
  const repos = new Set<string>();
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.endsWith(".git")) continue;
    const parent = trimmed
      .slice(0, -".git".length)
      .replace(/^\.\/?/, "")
      .replace(/\/$/, "");
    repos.add(parent);
  }
  return [...repos].sort((a, b) => a.localeCompare(b));
}

const STATUS_BY_CODE: Record<string, WorkspaceChangeStatus> = {
  A: "added",
  M: "modified",
  D: "deleted",
  R: "renamed",
  C: "added",
  T: "modified",
  U: "conflict",
};

/**
 * Parse `git status --porcelain=v1 -z`. Each entry is "XY path\0", renames add
 * a second "\0 original path". Index and worktree columns are folded into one
 * status; anything unmerged is a conflict.
 */
export function parseGitStatus(stdout: string): WorkspaceChange[] {
  const parts = stdout.split("\0");
  const changes: WorkspaceChange[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const entry = parts[i];
    if (!entry || entry.length < 4) continue;
    const x = entry[0] ?? " ";
    const y = entry[1] ?? " ";
    const path = entry.slice(3);
    if (x === "R" || x === "C") i += 1;
    let status: WorkspaceChangeStatus;
    if (x === "?" && y === "?") status = "untracked";
    else if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D"))
      status = "conflict";
    else if (y === "D" || x === "D") status = "deleted";
    else status = STATUS_BY_CODE[x !== " " ? x : y] ?? "modified";
    changes.push({ path, status });
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

export function gitStatusArgv(): string[] {
  return ["git", "status", "--porcelain=v1", "-z", "--untracked-files=all"];
}

/** Diff of one file against HEAD; untracked files diff against nothing. */
export function gitDiffArgv(status: WorkspaceChangeStatus, path: string): string[] {
  if (status === "untracked") return ["git", "diff", "--no-index", "--", "/dev/null", path];
  return ["git", "diff", "HEAD", "--", path];
}

/** Keep diffs bounded so a generated file cannot flood the panel. */
export function truncateDiff(
  diff: string,
  maxBytes = MAX_DIFF_BYTES,
): {
  diff: string;
  truncated: boolean;
} {
  if (Buffer.byteLength(diff, "utf8") <= maxBytes) return { diff, truncated: false };
  let cut = diff.slice(0, maxBytes);
  const lastNewline = cut.lastIndexOf("\n");
  if (lastNewline > 0) cut = cut.slice(0, lastNewline);
  return { diff: cut, truncated: true };
}

/** A path inside a repository must stay inside it: no absolute paths, no `..`. */
export function isSafeRepoRelativePath(value: string): boolean {
  if (!value || value.startsWith("/") || value.includes("\0")) return false;
  return !value.split("/").some((segment) => segment === ".." || segment === "");
}
