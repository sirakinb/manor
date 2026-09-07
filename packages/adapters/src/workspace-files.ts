import { randomUUID } from "node:crypto";
import type { AdapterContext, ComputerRef, SandboxProvider } from "@rakazo/adapter-kit";
import {
  WORKSPACE_FILE_MAX_BYTES,
  type WorkspaceFileOperation,
  type WorkspaceFileResult,
  WorkspaceFileResultSchema,
} from "@rakazo/contracts";
import { WORKSPACE_FILE_SCRIPT } from "./workspace-file-script.js";

export class WorkspaceFileError extends Error {
  constructor(
    message: string,
    readonly code: "BAD_REQUEST" | "CONFLICT" | "NOT_FOUND" | "TIMEOUT" = "BAD_REQUEST",
  ) {
    super(message);
  }
}

/** Provider-neutral commands execute in the computer, never in the API host's working directory. */
export async function manageWorkspaceFiles(
  sandbox: SandboxProvider,
  computer: ComputerRef,
  request: { base: string; destinationBase?: string; operation: WorkspaceFileOperation },
  context: AdapterContext,
): Promise<WorkspaceFileResult> {
  context = { ...context, signal: AbortSignal.any([context.signal, AbortSignal.timeout(90_000)]) };
  let stage: string | undefined;
  let operation = request.operation;
  if (operation.action === "write" || operation.action === "upload") {
    const bytes =
      operation.action === "write"
        ? Buffer.from(operation.content, "utf8")
        : decodeWorkspaceUpload(operation.dataBase64);
    if (bytes.length > WORKSPACE_FILE_MAX_BYTES)
      throw new WorkspaceFileError("Files must be 10 MiB or smaller");
    stage = `.rakazo-transfer-${randomUUID()}`;
    // A random root-level transfer avoids command-line size limits and user-selected staging paths.
    await sandbox.writeFile(computer, { path: stage, content: bytes }, context);
    operation =
      operation.action === "write"
        ? { ...operation, content: "" }
        : { ...operation, dataBase64: "" };
  }
  let stdout = "";
  let code = -1;
  for await (const event of sandbox.execute(
    computer,
    {
      argv: [
        "python3",
        "-c",
        WORKSPACE_FILE_SCRIPT,
        JSON.stringify({ ...request, operation, stage }),
      ],
      timeoutMs: 60_000,
    },
    context,
  )) {
    if (event.type === "stdout") {
      stdout += event.data;
      if (stdout.length > 20_000_000) throw new WorkspaceFileError("File response is too large");
    }
    if (event.type === "exit") code = event.code;
  }
  if (code !== 0)
    throw new WorkspaceFileError(
      "File management requires Python 3 on this computer. Ask the bot to check its workspace tools.",
    );
  let result: { result?: unknown; error?: string; code?: string };
  try {
    result = JSON.parse(stdout);
  } catch {
    throw new WorkspaceFileError("This computer does not support workspace file management");
  }
  if (result.error) {
    const errorCode =
      result.code === "CONFLICT" || result.code === "NOT_FOUND" || result.code === "TIMEOUT"
        ? result.code
        : "BAD_REQUEST";
    throw new WorkspaceFileError(result.error, errorCode);
  }
  return WorkspaceFileResultSchema.parse(result.result);
}

export function decodeWorkspaceUpload(value: string): Buffer {
  const bytes = Buffer.from(value, "base64");
  if (bytes.length > WORKSPACE_FILE_MAX_BYTES)
    throw new WorkspaceFileError("Files must be 10 MiB or smaller");
  // Buffer accepts malformed input; a canonical round trip validates it without a
  // repeated-group regex exhausting the JS stack on multi-megabyte uploads.
  if (bytes.toString("base64") !== value) throw new WorkspaceFileError("Invalid file data");
  return bytes;
}
