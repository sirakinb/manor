import { spawn } from "node:child_process";
import { lstat, mkdir, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  isInsideLocalRoot,
  LOCAL_COMPUTER_PATH_ESCAPE_MESSAGE,
  resolveLocalRelativePath,
} from "./local-computer-share.js";
import {
  boundedSandboxCommandTimeoutMs,
  DEFAULT_SANDBOX_COMMAND_TIMEOUT_MS,
} from "./sandbox-command.js";

export interface LocalFolderListEntry {
  path: string;
  kind: "file" | "dir";
  size: number;
}

export interface LocalFolderShellResult {
  stdout: string;
  stderr: string;
  code: number;
}

const MAX_READ_BYTES = 2_000_000;

async function assertContained(target: string, root: string): Promise<string> {
  let realTarget: string;
  let realRoot: string;
  try {
    realRoot = await realpath(root);
  } catch {
    throw new Error(LOCAL_COMPUTER_PATH_ESCAPE_MESSAGE);
  }
  try {
    realTarget = await realpath(target);
  } catch {
    const parent = path.dirname(target);
    const realParent = await realpath(parent).catch(() => null);
    if (!realParent || !isInsideLocalRoot(realParent, realRoot)) {
      throw new Error(LOCAL_COMPUTER_PATH_ESCAPE_MESSAGE);
    }
    realTarget = path.resolve(realParent, path.basename(target));
  }
  if (!isInsideLocalRoot(realTarget, realRoot)) throw new Error(LOCAL_COMPUTER_PATH_ESCAPE_MESSAGE);
  const stat = await lstat(realTarget).catch(() => null);
  if (stat?.isSymbolicLink()) throw new Error(LOCAL_COMPUTER_PATH_ESCAPE_MESSAGE);
  return realTarget;
}

export async function listLocalFolder(
  root: string,
  relativePath: string,
): Promise<LocalFolderListEntry[]> {
  const target = await assertContained(resolveLocalRelativePath(root, relativePath), root);
  const entries = await readdir(target, { withFileTypes: true });
  const listed: LocalFolderListEntry[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const child = path.join(target, entry.name);
    if (!isInsideLocalRoot(child, root)) continue;
    const info = await lstat(child);
    listed.push({
      path: path.posix
        .join(relativePath.replace(/\\/g, "/").replace(/^\/+/, ""), entry.name)
        .replace(/^\//, ""),
      kind: info.isDirectory() ? "dir" : "file",
      size: info.isDirectory() ? 0 : info.size,
    });
  }
  return listed.sort((left, right) => left.path.localeCompare(right.path));
}

export async function readLocalFolderFile(
  root: string,
  relativePath: string,
  maxBytes = MAX_READ_BYTES,
): Promise<Uint8Array> {
  const target = await assertContained(resolveLocalRelativePath(root, relativePath), root);
  const info = await lstat(target);
  if (info.isDirectory()) throw new Error("Path is a directory");
  if (info.size > maxBytes) throw new Error(`File is larger than ${maxBytes} bytes`);
  return new Uint8Array(await readFile(target));
}

export async function writeLocalFolderFile(
  root: string,
  relativePath: string,
  content: Uint8Array,
): Promise<void> {
  const target = resolveLocalRelativePath(root, relativePath);
  const parent = path.dirname(target);
  await mkdir(parent, { recursive: true });
  await assertContained(parent, root);
  if (!isInsideLocalRoot(target, root)) throw new Error(LOCAL_COMPUTER_PATH_ESCAPE_MESSAGE);
  await writeFile(target, content);
  await assertContained(target, root);
}

export async function runLocalFolderShell(
  root: string,
  request: { argv: string[]; cwd?: string; timeoutMs?: number; signal?: AbortSignal },
): Promise<LocalFolderShellResult> {
  const argv = request.argv;
  if (argv.length === 0) throw new Error("shell requires a command");
  const cwd = request.cwd
    ? await assertContained(resolveLocalRelativePath(root, request.cwd), root)
    : await assertContained(root, root);
  const timeoutMs = boundedSandboxCommandTimeoutMs(
    request.timeoutMs,
    DEFAULT_SANDBOX_COMMAND_TIMEOUT_MS,
  );
  const [command, ...args] = argv;
  if (!command) throw new Error("shell requires a command");

  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        HOME: root,
        PWD: cwd,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutMs);
    const onAbort = () => child.kill("SIGKILL");
    request.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > 200_000) stdout = `${stdout.slice(0, 200_000)}\n…truncated`;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
      if (stderr.length > 80_000) stderr = `${stderr.slice(0, 80_000)}\n…truncated`;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", onAbort);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", onAbort);
      resolve({ stdout, stderr, code: code ?? 1 });
    });
  });
}

export async function executeLocalFolderRpc(input: {
  root: string;
  method: string;
  params: unknown;
}): Promise<unknown> {
  const params = (input.params ?? {}) as Record<string, unknown>;
  switch (input.method) {
    case "list_files":
      return listLocalFolder(input.root, String(params.path ?? ""));
    case "read_file": {
      const bytes = await readLocalFolderFile(
        input.root,
        String(params.path ?? ""),
        typeof params.maxBytes === "number" ? params.maxBytes : undefined,
      );
      return { contentBase64: Buffer.from(bytes).toString("base64") };
    }
    case "write_file": {
      const content = Buffer.from(String(params.contentBase64 ?? ""), "base64");
      await writeLocalFolderFile(input.root, String(params.path ?? ""), new Uint8Array(content));
      return { ok: true };
    }
    case "shell": {
      const argv = Array.isArray(params.argv) ? params.argv.map(String) : [];
      return runLocalFolderShell(input.root, {
        argv,
        cwd: typeof params.cwd === "string" && params.cwd.length > 0 ? params.cwd : undefined,
        timeoutMs: typeof params.timeoutMs === "number" ? params.timeoutMs : undefined,
      });
    }
    default:
      throw new Error(`Unknown local computer method: ${input.method}`);
  }
}
