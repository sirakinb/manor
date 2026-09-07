import * as z from "zod";
import { RunSchema } from "./domain.js";
import { Id, RunStatus } from "./ids.js";

export const RunFailureDiagnosticSchema = z.object({
  stage: z.enum(["model", "tool", "execution", "unknown"]),
  category: z.enum(["network", "timeout", "rate_limit", "authentication", "unknown"]),
  code: z
    .enum([
      "ECONNRESET",
      "ECONNREFUSED",
      "ETIMEDOUT",
      "ENOTFOUND",
      "EAI_AGAIN",
      "UND_ERR_CONNECT_TIMEOUT",
      "UND_ERR_HEADERS_TIMEOUT",
      "UND_ERR_BODY_TIMEOUT",
      "UND_ERR_SOCKET",
    ])
    .nullable(),
});
export type RunFailureDiagnostic = z.infer<typeof RunFailureDiagnosticSchema>;

export const RunDiagnosticsSchema = z.object({
  run: RunSchema,
  failure: RunFailureDiagnosticSchema.nullable(),
  attempts: z.array(
    z.object({ status: z.string(), startedAt: z.string(), finishedAt: z.string().nullable() }),
  ),
  events: z.array(
    z.object({
      id: Id,
      seq: z.number().int(),
      type: z.string(),
      createdAt: z.string(),
      tool: z.string().nullable(),
      status: z.enum(["completed", "failed", "paused"]).nullable(),
      durationMs: z.number().nonnegative().nullable(),
    }),
  ),
  olderCursor: z.number().int().nullable(),
});
export type RunDiagnostics = z.infer<typeof RunDiagnosticsSchema>;
export const BotRunHistorySchema = z.object({ runs: z.array(RunSchema) });

export const RunActivityRowSchema = z.object({
  runId: Id,
  botId: Id,
  botName: z.string(),
  groupId: Id.nullable(),
  groupName: z.string().nullable(),
  threadId: Id,
  status: RunStatus,
  trigger: z.enum([
    "user",
    "routine",
    "resume",
    "follow_up",
    "reaction",
    "spawn",
    "skill",
    "bot_message",
    "webhook",
    "messaging",
  ]),
  notificationsEnabled: z.boolean(),
  promptSnippet: z.string(),
  updatedAt: z.string(),
});
export type RunActivityRow = z.infer<typeof RunActivityRowSchema>;

export const RunsListOutputSchema = z.object({
  runs: z.array(RunActivityRowSchema),
});
export type RunsListOutput = z.infer<typeof RunsListOutputSchema>;
