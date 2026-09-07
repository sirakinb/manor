import { z } from "zod";

export const MaintenanceRevisionSchema = z.string().regex(/^[a-f0-9]{40}$/);
export const MaintenanceReviewSchema = z.object({
  baseRevision: MaintenanceRevisionSchema,
  revision: MaintenanceRevisionSchema,
  branch: z.string().regex(/^maintenance\/[a-zA-Z0-9-]+$/),
  diff: z.string().max(200_000),
  checks: z
    .array(z.object({ name: z.string().min(1).max(120), passed: z.boolean() }))
    .min(1)
    .max(100),
  // Attested by the workspace service, never by the agent or a client.
  isolationVerified: z.literal(true),
  requiredChecksPassed: z.boolean(),
  publicationSafe: z.boolean(),
  previewUrl: z
    .string()
    .url()
    .refine((value) => new URL(value).protocol === "https:")
    .nullable(),
  previewSummary: z.string().max(2000),
  updates: z.object({ web: z.boolean(), desktop: z.boolean(), mobile: z.boolean() }),
});
export type MaintenanceReview = z.infer<typeof MaintenanceReviewSchema>;

export const MaintenanceStatusSchema = z.enum([
  "queued",
  "investigating",
  "review",
  "approved",
  "releasing",
  "completed",
  "failed",
  "blocked",
  "cancelled",
]);
export const MaintenanceJobSchema = z.object({
  id: z.string(),
  issue: z.string(),
  runId: z.string().nullable(),
  status: MaintenanceStatusSchema,
  review: MaintenanceReviewSchema.nullable(),
  reviewKey: z.string().nullable(),
  approvedRevision: MaintenanceRevisionSchema.nullable(),
  message: z.string(),
  simulated: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MaintenanceJob = z.infer<typeof MaintenanceJobSchema>;
export const MaintenanceCreateSchema = z.object({
  requestId: z.string().regex(/^[a-zA-Z0-9-]{8,128}$/),
  issue: z.string().trim().min(1).max(8000),
  runId: z.string().min(1).max(200).optional(),
});
export type MaintenanceCreate = z.infer<typeof MaintenanceCreateSchema>;
export const MaintenanceApprovalSchema = z.object({
  id: z.string().min(1),
  revision: MaintenanceRevisionSchema,
  reviewKey: z.string().min(1).max(300),
});
export type MaintenanceApproval = z.infer<typeof MaintenanceApprovalSchema>;
export const MaintenanceOverviewSchema = z.object({
  mode: z.enum(["unavailable", "test", "connected"]),
  jobs: z.array(MaintenanceJobSchema),
});
export type MaintenanceOverview = z.infer<typeof MaintenanceOverviewSchema>;
