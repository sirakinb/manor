import { createHash } from "node:crypto";
import {
  WORKSPACE_FILE_MAX_BYTES,
  WORKSPACE_TEXT_MAX_BYTES,
  WorkspaceFileOperationSchema,
  type WorkspaceFileResult,
} from "@rakazo/contracts";
import type { FakeBox } from "./fake-sandbox.js";

/** The in-memory computer's translation of the workspace command, without executing host commands. */
export function fakeWorkspaceFiles(box: FakeBox, input: string): string {
  const req = JSON.parse(input);
  const operation = WorkspaceFileOperationSchema.parse(req.operation);
  const base: string = req.base;
  const join = (a: string, b: string) => [a, b].filter(Boolean).join("/");
  const full = join(base, "path" in operation ? operation.path : "");
  const hash = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
  const descendants = (p: string) =>
    [...box.files]
      .filter(([key]) => key.startsWith(`${p}/`))
      .sort(([a], [b]) => a.localeCompare(b));
  const revision = (p: string) => {
    const file = box.files.get(p);
    if (file) return hash(file.content);
    const children = descendants(p);
    if (!children.length) throw new Error("File or folder no longer exists");
    return hash(children.map(([name, child]) => `${name}:${hash(child.content)}`).join("\n"));
  };
  const exists = (p: string) => box.files.has(p) || descendants(p).length > 0;
  try {
    let result: WorkspaceFileResult;
    if (operation.action === "list") {
      const entries = new Map<string, { path: string; kind: "file" | "dir"; size: number }>();
      for (const [p, file] of box.files) {
        if (!p.startsWith(full ? `${full}/` : "")) continue;
        const relative = p.slice(base ? base.length + 1 : 0);
        const suffix = p.slice(full ? full.length + 1 : 0);
        const visibleSegments = operation.search ? suffix.split("/") : [suffix.split("/")[0]!];
        if (
          visibleSegments.some(
            (name) =>
              name.startsWith(".rakazo-") ||
              name === ".git" ||
              (!operation.hidden && name.startsWith(".")),
          )
        )
          continue;
        const child = operation.search ? relative : join(operation.path, suffix.split("/")[0]!);
        if (operation.search && !child.toLowerCase().includes(operation.search.toLowerCase()))
          continue;
        entries.set(child, {
          path: child,
          kind: !operation.search && suffix.includes("/") ? "dir" : "file",
          size: file.content.byteLength,
        });
      }
      result = {
        kind: "list",
        entries: [...entries.values()].slice(0, 2000),
        truncated: entries.size > 2000,
      };
    } else if (operation.action === "read" || operation.action === "download") {
      const file = box.files.get(full);
      if (!file) throw new Error("File or folder no longer exists");
      const data = Buffer.from(file.content);
      if (data.length > WORKSPACE_FILE_MAX_BYTES)
        throw new Error("File is too large for this operation");
      const extension = operation.path.split(".").at(-1)?.toLowerCase() ?? "";
      const mimeType =
        (
          {
            png: "image/png",
            jpg: "image/jpeg",
            jpeg: "image/jpeg",
            webp: "image/webp",
            gif: "image/gif",
            pdf: "application/pdf",
            md: "text/markdown",
          } as Record<string, string>
        )[extension] ?? "text/plain";
      let content: string | null = null;
      if (
        mimeType.startsWith("text/") &&
        data.length <= WORKSPACE_TEXT_MAX_BYTES &&
        !data.includes(0)
      ) {
        try {
          content = new TextDecoder("utf-8", { fatal: true }).decode(data);
        } catch {
          /* binary */
        }
      }
      result = {
        kind: "file",
        path: operation.path,
        revision: hash(data),
        content,
        mimeType:
          content === null && mimeType === "text/plain" ? "application/octet-stream" : mimeType,
        size: data.length,
        ...(operation.action === "download" || !mimeType.startsWith("text/")
          ? { dataBase64: data.toString("base64") }
          : {}),
      };
    } else if (operation.action === "inspect")
      result = { kind: "revision", revision: revision(full) };
    else if (operation.action === "git-status")
      result = { kind: "git", repos: [], truncated: false };
    else if (operation.action.startsWith("git-"))
      throw new Error(
        "Git controls require a computer with Git installed. The in-memory demo computer does not run Git.",
      );
    else {
      if ("revision" in operation && revision(full) !== operation.revision)
        return JSON.stringify({
          error: "This file or folder changed. Refresh and review it.",
          code: "CONFLICT",
        });
      if (operation.action === "create" || operation.action === "upload") {
        if (exists(full))
          return JSON.stringify({ error: "Destination already exists", code: "CONFLICT" });
      }
      if (operation.action === "create")
        box.files.set(operation.kind === "dir" ? `${full}/.gitkeep` : full, {
          content: new Uint8Array(),
          executable: false,
        });
      if (operation.action === "write" || operation.action === "upload") {
        const staged = box.files.get(req.stage);
        if (!staged) throw new Error("Transfer no longer exists");
        box.files.set(full, { ...staged, executable: box.files.get(full)?.executable ?? false });
      }
      if (operation.action === "move" || operation.action === "delete") {
        const dest =
          operation.action === "move" ? join(req.destinationBase, operation.destination) : "";
        if (operation.action === "move" && (exists(dest) || dest.startsWith(`${full}/`)))
          return JSON.stringify({
            error: "Destination already exists or is inside this folder",
            code: "CONFLICT",
          });
        const files = [...box.files].filter(([p]) => p === full || p.startsWith(`${full}/`));
        for (const [p, file] of files) {
          box.files.delete(p);
          if (operation.action === "move") box.files.set(dest + p.slice(full.length), file);
        }
      }
      result =
        operation.action === "write" || operation.action === "upload"
          ? { kind: "revision", revision: revision(full) }
          : { kind: "ok" };
    }
    return JSON.stringify({ result });
  } catch (error) {
    return JSON.stringify({
      error: error instanceof Error ? error.message : "File operation failed",
      code: "BAD_REQUEST",
    });
  } finally {
    if (req.stage) box.files.delete(req.stage);
  }
}
