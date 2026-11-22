import { oc } from "@orpc/contract";
import * as z from "zod";
import { Id, RunStatus } from "../ids.js";
import { botId } from "../rpc/inputs.js";
import { BotRunHistorySchema, RunDiagnosticsSchema } from "../run-logs.js";
import { RunsListOutputSchema } from "./runs.js";

export const runsRpc = {
  runs: {
    list: oc
      .input(z.object({ filter: z.enum(["active", "recent"]), status: RunStatus.optional() }))
      .output(RunsListOutputSchema),
    history: oc.input(botId).output(BotRunHistorySchema),
    diagnostics: oc
      .input(z.object({ runId: Id, before: z.number().int().nonnegative().optional() }))
      .output(RunDiagnosticsSchema),
  },
};
