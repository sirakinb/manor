export type FileEntry = { path: string; kind: "file" | "dir"; size: number };

/** Directories first, then files, each alphabetical and case-insensitive. */
export function sortEntries<T extends { path: string; kind: "file" | "dir" }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return baseName(a.path).localeCompare(baseName(b.path), undefined, { sensitivity: "base" });
  });
}

export function baseName(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const index = trimmed.lastIndexOf("/");
  return index === -1 ? trimmed : trimmed.slice(index + 1);
}

export function parentPath(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const index = trimmed.lastIndexOf("/");
  return index <= 0 ? "" : trimmed.slice(0, index);
}

export function joinPath(base: string, name: string): string {
  return base ? `${base.replace(/\/+$/, "")}/${name}` : name;
}

/** Breadcrumb segments for a workspace path: [{label, path}] with the root first. */
export function breadcrumbs(
  path: string,
  rootLabel: string,
): Array<{ label: string; path: string }> {
  const crumbs = [{ label: rootLabel, path: "" }];
  let current = "";
  for (const segment of path.split("/").filter(Boolean)) {
    current = joinPath(current, segment);
    crumbs.push({ label: segment, path: current });
  }
  return crumbs;
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

const BINARY_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "ico",
  "bmp",
  "tiff",
  "pdf",
  "zip",
  "gz",
  "tar",
  "bz2",
  "7z",
  "rar",
  "mp3",
  "mp4",
  "mov",
  "webm",
  "wav",
  "ogg",
  "flac",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "eot",
  "exe",
  "dll",
  "so",
  "dylib",
  "bin",
  "wasm",
  "sqlite",
  "db",
  "pyc",
  "class",
  "jar",
]);

export function looksBinary(path: string): boolean {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  if (dot === -1) return false;
  return BINARY_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

export type DiffLineKind = "add" | "del" | "hunk" | "meta" | "context";

/** Classify unified-diff lines for coloring; file headers and hunks are dimmed. */
export function classifyDiffLine(line: string): DiffLineKind {
  if (line.startsWith("+++") || line.startsWith("---")) return "meta";
  if (
    line.startsWith("diff ") ||
    line.startsWith("index ") ||
    line.startsWith("new file") ||
    line.startsWith("deleted file") ||
    line.startsWith("similarity") ||
    line.startsWith("rename") ||
    line.startsWith("Binary files") ||
    line.startsWith("\\ No newline")
  )
    return "meta";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return "context";
}
