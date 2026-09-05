import * as z from "zod";

export const Id = z.string().min(1);
export const IsoDate = z.string().datetime({ offset: true });

export const ActorSchema = z.object({
  userId: Id,
  spaceId: Id,
  organizationId: Id,
  email: z.string().email(),
  isDeploymentOwner: z.boolean(),
  portalOrganizationId: Id.optional(),
});
export type Actor = z.infer<typeof ActorSchema>;

// Manor sprite family. Keep in sync with ui-tokens botColors and the
// SPRITES map in ui-web/bot-avatar.tsx.
export const BOT_COLORS = [
  "#8B5CF6",
  "#F5C542",
  "#3FB6AE",
  "#A78BFA",
  "#F08040",
  "#E0524D",
  "#5B8DEF",
] as const;

export const RunStatus = z.enum([
  "queued",
  "leased",
  "running",
  "waiting_input",
  "waiting_takeover",
  "completed",
  "failed",
  "cancelled",
]);
export type RunStatus = z.infer<typeof RunStatus>;

export const EffectStatus = z.enum(["intended", "completed", "failed", "ambiguous", "reconciled"]);
export type EffectStatus = z.infer<typeof EffectStatus>;

export const MemoryScope = z.enum(["bot", "user"]);
export type MemoryScope = z.infer<typeof MemoryScope>;

export const SandboxKind = z.enum(["docker", "e2b", "daytona", "box", "desktop", "fake"]);
export type SandboxKind = z.infer<typeof SandboxKind>;
