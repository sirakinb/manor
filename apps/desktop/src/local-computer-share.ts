export const LOCAL_COMPUTER_MUTATING_TOOLS = new Set(["write_file", "shell"]);
export const LOCAL_COMPUTER_OFFLINE_MESSAGE =
  "This Mac is not sharing. Open Manor desktop to share a folder.";
export const LOCAL_COMPUTER_GUI_MESSAGE =
  "This Mac session has no graphical desktop. Files and shell only.";
export const LOCAL_COMPUTER_HOME_ROOT_MESSAGE = "Pick one project folder, not the home directory.";
export const LOCAL_COMPUTER_PATH_ESCAPE_MESSAGE = "Path escapes the shared folder";
export const LOCAL_COMPUTER_DENIED_MESSAGE = "Denied on this Mac";

export function isLocalComputerMutatingTool(toolName: string): boolean {
  return LOCAL_COMPUTER_MUTATING_TOOLS.has(toolName);
}

export function localComputerFolderName(folderPath: string): string {
  const normalized = folderPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const base = normalized.split("/").filter(Boolean).pop();
  return base || "folder";
}

export function assertNotHomeRoot(folderPath: string, homeDir: string): void {
  if (isHomeDirectoryShare(folderPath, homeDir)) {
    throw new Error(LOCAL_COMPUTER_HOME_ROOT_MESSAGE);
  }
}

export function isHomeDirectoryShare(folderPath: string, homeDir: string): boolean {
  return normalizeAbsolute(folderPath) === normalizeAbsolute(homeDir);
}

export function isInsideLocalRoot(target: string, root: string): boolean {
  const resolvedTarget = normalizeAbsolute(target);
  const resolvedRoot = normalizeAbsolute(root);
  if (resolvedTarget === resolvedRoot) return true;
  const prefix = resolvedRoot.endsWith("/") ? resolvedRoot : `${resolvedRoot}/`;
  return resolvedTarget.startsWith(prefix);
}

export function resolveLocalRelativePath(root: string, relative: string): string {
  const portable = relative.replace(/\\/g, "/").replace(/^\/+/, "");
  const segments = portable.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error(LOCAL_COMPUTER_PATH_ESCAPE_MESSAGE);
  }
  const joined =
    segments.length === 0
      ? normalizeAbsolute(root)
      : `${normalizeAbsolute(root)}/${segments.join("/")}`;
  if (!isInsideLocalRoot(joined, root)) throw new Error(LOCAL_COMPUTER_PATH_ESCAPE_MESSAGE);
  return joined;
}

export function unattendedRunUsesCloudComputer(trigger: string): boolean {
  return trigger === "routine" || trigger === "webhook";
}

function normalizeAbsolute(value: string): string {
  const posix = value.replace(/\\/g, "/");
  const parts: string[] = [];
  const absolute = posix.startsWith("/");
  const driveMatch = posix.match(/^([A-Za-z]:)(\/|$)/);
  const drive = driveMatch?.[1];
  const rest = drive ? posix.slice(drive.length) : posix;
  const isAbs = absolute || Boolean(drive);
  for (const segment of rest.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  const joined = parts.join("/");
  if (drive) return joined ? `${drive}/${joined}` : drive;
  if (!isAbs) return joined;
  return joined ? `/${joined}` : "/";
}
