import * as z from "zod";
import { Id } from "./ids.js";

export const LocalComputerLiveSessionSchema = z.object({
  connected: z.boolean(),
  folderName: z.string().nullable(),
  lastCommand: z.string().nullable(),
});
export type LocalComputerLiveSession = z.infer<typeof LocalComputerLiveSessionSchema>;

export const LocalDeviceSchema = z.object({
  id: Id,
  name: z.string(),
  tokenPrefix: z.string(),
  connected: z.boolean(),
  folderName: z.string().nullable(),
  lastSeenAt: z.string().nullable(),
  createdAt: z.string(),
  revokedAt: z.string().nullable(),
});
export type LocalDevice = z.infer<typeof LocalDeviceSchema>;
