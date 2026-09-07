import * as z from "zod";

export const WORKSPACE_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const WORKSPACE_TEXT_MAX_BYTES = 2 * 1024 * 1024;
export const WorkspaceLocationSchema = z.enum(["bot", "shared"]);
export type WorkspaceLocation = z.infer<typeof WorkspaceLocationSchema>;

/** Paths in the Files UI are relative to the selected location, never host paths. */
export const WorkspaceFilePathSchema = z
  .string()
  .max(1000)
  .refine(
    (value) =>
      value === "" ||
      (!value.includes("\\") &&
        ![...value].some(
          (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        ) &&
        !value.startsWith("/") &&
        value
          .split("/")
          .every(
            (part) =>
              part !== "" &&
              part !== "." &&
              part !== ".." &&
              part !== ".git" &&
              part !== ".rakazo-files.lock" &&
              !part.startsWith(".rakazo-transfer-"),
          )),
    "Use a relative workspace path without .git, parent segments, or control characters",
  );
const filePath = WorkspaceFilePathSchema.refine(
  (value) => value.length > 0,
  "Choose a file or folder",
);
const revision = z.string().regex(/^[a-f0-9]{64}$/);
export const WorkspaceFileOperationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("list"),
    path: WorkspaceFilePathSchema,
    search: z.string().max(100).default(""),
    hidden: z.boolean().default(false),
  }),
  z.object({ action: z.literal("read"), path: filePath }),
  z.object({ action: z.literal("download"), path: filePath }),
  z.object({
    action: z.literal("write"),
    path: filePath,
    content: z.string().max(WORKSPACE_TEXT_MAX_BYTES),
    revision,
  }),
  z.object({ action: z.literal("create"), path: filePath, kind: z.enum(["file", "dir"]) }),
  z.object({ action: z.literal("upload"), path: filePath, dataBase64: z.string().max(14_000_000) }),
  z.object({
    action: z.literal("move"),
    path: filePath,
    destination: filePath,
    destinationLocation: WorkspaceLocationSchema,
    revision,
  }),
  z.object({ action: z.literal("delete"), path: filePath, revision }),
  z.object({ action: z.literal("inspect"), path: filePath }),
  z.object({ action: z.literal("git-status") }),
  z.object({ action: z.literal("git-diff"), path: WorkspaceFilePathSchema, file: filePath }),
  z.object({ action: z.literal("git-init"), path: WorkspaceFilePathSchema }),
  z.object({
    action: z.literal("git-commit"),
    path: WorkspaceFilePathSchema,
    revision,
    message: z.string().trim().min(1).max(2000),
    files: z.array(filePath).min(1).max(200),
  }),
  z.object({
    action: z.literal("git-branch"),
    path: WorkspaceFilePathSchema,
    revision,
    branch: z.string().min(1).max(100),
    create: z.boolean(),
  }),
]);
export type WorkspaceFileOperation = z.infer<typeof WorkspaceFileOperationSchema>;
export const WorkspaceFileRequestSchema = z.object({
  botId: z.string().min(1),
  location: WorkspaceLocationSchema.default("bot"),
  operation: WorkspaceFileOperationSchema,
});
export type WorkspaceFileRequest = z.infer<typeof WorkspaceFileRequestSchema>;
export const WorkspaceEntrySchema = z.object({
  path: z.string(),
  kind: z.enum(["file", "dir"]),
  size: z.number(),
});
export type WorkspaceEntry = z.infer<typeof WorkspaceEntrySchema>;
export const WorkspaceRepoSchema = z.object({
  path: z.string(),
  branch: z.string(),
  branches: z.array(z.string()),
  revision,
  files: z.array(
    z.object({
      path: z.string(),
      status: z.enum(["added", "modified", "deleted", "renamed", "untracked", "conflict"]),
    }),
  ),
});
export type WorkspaceRepo = z.infer<typeof WorkspaceRepoSchema>;
export const WorkspaceFileResultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("list"),
    entries: z.array(WorkspaceEntrySchema),
    truncated: z.boolean(),
  }),
  z.object({
    kind: z.literal("file"),
    path: z.string(),
    revision,
    content: z.string().nullable(),
    dataBase64: z.string().optional(),
    mimeType: z.string(),
    size: z.number(),
  }),
  z.object({ kind: z.literal("revision"), revision }),
  z.object({ kind: z.literal("ok") }),
  z.object({ kind: z.literal("git"), repos: z.array(WorkspaceRepoSchema), truncated: z.boolean() }),
  z.object({ kind: z.literal("diff"), diff: z.string(), truncated: z.boolean() }),
]);
export type WorkspaceFileResult = z.infer<typeof WorkspaceFileResultSchema>;
export function workspaceOperationMutates(operation: WorkspaceFileOperation): boolean {
  return [
    "write",
    "create",
    "upload",
    "move",
    "delete",
    "git-init",
    "git-commit",
    "git-branch",
  ].includes(operation.action);
}

export function workspacePreviewType(name: string): "image" | "pdf" | "markdown" | "text" {
  if (/\.(png|jpe?g|gif|webp)$/i.test(name)) return "image";
  if (/\.pdf$/i.test(name)) return "pdf";
  if (/\.(md|markdown)$/i.test(name)) return "markdown";
  return "text";
}
