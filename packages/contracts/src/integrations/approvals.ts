import * as z from "zod";
import { Id } from "../ids.js";

export const ActionApprovalRuleSchema = z.object({
  id: Id,
  effect: z.enum(["always_allow", "require_approval", "deny"]),
  matchKind: z.enum(["tool", "connector", "category", "site"]),
  matchValue: z.string(),
  createdAt: z.string(),
});
export type ActionApprovalRule = z.infer<typeof ActionApprovalRuleSchema>;

/** How much a space asks before acting; see VISION.md. */
export const ApprovalModeSchema = z.enum(["never", "auto", "ask"]);
export type ApprovalMode = z.infer<typeof ApprovalModeSchema>;

export const ActionAutoReviewSettingsSchema = z.object({
  mode: ApprovalModeSchema,
  /** The stored form of `mode`, kept for clients that predate it. */
  enabled: z.boolean(),
  /** Check finished replies against the tool results they rely on. */
  checkAnswers: z.boolean(),
  checkerAvailable: z.boolean(),
  engine: z.string(),
  compare: z.boolean(),
  /** Checker engines this deployment offers; only available ones can be selected. */
  engines: z.array(z.object({ id: z.string(), label: z.string(), available: z.boolean() })),
  skipApprovals: z.boolean(),
});
export type ActionAutoReviewSettings = z.infer<typeof ActionAutoReviewSettingsSchema>;
