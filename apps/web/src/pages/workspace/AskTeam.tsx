import type { Bot } from "@rakazo/contracts";
import { createContext } from "react";

export const WorkspaceTeamContext = createContext<{
  bots: Bot[];
  ask: (subject: string, botId?: string) => void;
  busy: boolean;
} | null>(null);
