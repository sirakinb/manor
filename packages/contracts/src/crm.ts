import * as z from "zod";
import { Id } from "./ids.js";

export const CrmTagSchema = z.object({
  id: Id,
  name: z.string(),
  color: z.string().nullable(),
});
export type CrmTag = z.infer<typeof CrmTagSchema>;

export const CrmContactSchema = z.object({
  id: Id,
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  company: z.string().nullable(),
  notes: z.string().nullable(),
  status: z.enum(["active", "archived"]),
  tags: z.array(CrmTagSchema),
  createdAt: z.string(),
});
export type CrmContact = z.infer<typeof CrmContactSchema>;

export const CrmStageSchema = z.object({
  id: Id,
  pipelineId: Id,
  name: z.string(),
  position: z.number().int(),
  color: z.string().nullable(),
});
export type CrmStage = z.infer<typeof CrmStageSchema>;

export const CrmPipelineSchema = z.object({
  id: Id,
  name: z.string(),
  position: z.number().int(),
  stages: z.array(CrmStageSchema),
});
export type CrmPipeline = z.infer<typeof CrmPipelineSchema>;

export const CrmDealSchema = z.object({
  id: Id,
  pipelineId: Id,
  stageId: Id,
  contactId: Id.nullable(),
  title: z.string(),
  value: z.number().int().nonnegative(),
  status: z.enum(["open", "won", "lost"]),
  createdAt: z.string(),
});
export type CrmDeal = z.infer<typeof CrmDealSchema>;

/// Everything the CRM's three surfaces need, in one round trip.
export const CrmOverviewSchema = z.object({
  pipelines: z.array(CrmPipelineSchema),
  deals: z.array(CrmDealSchema),
  contacts: z.array(CrmContactSchema),
  tags: z.array(CrmTagSchema),
});
export type CrmOverview = z.infer<typeof CrmOverviewSchema>;
