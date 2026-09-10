import { z } from "zod";

export const TEAM_HEARTBEAT_MS = 30_000;
export const TEAM_ACTIVE_MS = 90_000;
export const TEAM_IDLE_MS = 5 * 60_000;

export const TeamMemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  lastSignedInAt: z.string().datetime().nullable(),
  lastActiveAt: z.string().datetime().nullable(),
  active: z.boolean(),
});
export type TeamMember = z.infer<typeof TeamMemberSchema>;
