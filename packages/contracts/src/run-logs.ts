import * as z from "zod";
import { Id } from "./ids.js";
import { RunFailureDiagnosticSchema, RunSchema } from "./runs/runs.js";

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
