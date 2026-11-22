import * as z from "zod";

const VerdictSchema = z.object({
  engine: z.string(),
  role: z.string(),
  decision: z.string(),
  reason: z.string().nullable(),
  probability: z.number().nullable(),
  confidence: z.number().nullable(),
  /** Engine evidence, e.g. `{ claims: [{ text, supported, probability }] }` for reply checks. */
  details: z.unknown(),
  model: z.string(),
  latencyMs: z.number(),
});

export const VerificationSummarySchema = z.object({
  engines: z.array(z.object({ id: z.string(), label: z.string() })),
  /** True when the window held more checks than one summary covers; the oldest were left out. */
  truncated: z.boolean(),
  checkpoints: z.array(
    z.object({
      checkpoint: z.string(),
      engines: z.array(
        z.object({
          engine: z.string(),
          checks: z.number(),
          flagged: z.number(),
          errors: z.number(),
          flagRate: z.number().nullable(),
          medianLatencyMs: z.number().nullable(),
          costUsd: z.number(),
          answered: z.object({ correct: z.number(), total: z.number() }),
        }),
      ),
      compared: z.number(),
      agreed: z.number(),
    }),
  ),
  daily: z.array(
    z.object({
      day: z.string(),
      checkpoint: z.string(),
      engine: z.string(),
      checks: z.number(),
      flagRate: z.number().nullable(),
      medianLatencyMs: z.number().nullable(),
    }),
  ),
  disagreements: z.array(
    z.object({
      createdAt: z.string(),
      checkpoint: z.string(),
      subject: z.string(),
      botId: z.string(),
      botName: z.string(),
      threadId: z.string(),
      task: z.string(),
      userAnswer: z.enum(["allowed", "denied"]).nullable(),
      verdicts: z.array(VerdictSchema),
    }),
  ),
  bots: z.array(z.object({ id: z.string(), name: z.string() })),
});
export type VerificationSummaryDto = z.infer<typeof VerificationSummarySchema>;
