import { Trans } from "@lingui/react/macro";
import type { Bot } from "@rakazo/contracts";
import { createContext, useContext } from "react";
import { BuiButton } from "../../components/beautiful-ui/primitives";

export const WorkspaceTeamContext = createContext<{
  bots: Bot[];
  ask: (subject: string, botId?: string) => void;
  busy: boolean;
} | null>(null);

export function AskTeamButton({ subject }: { subject: string }) {
  const team = useContext(WorkspaceTeamContext);
  if (!team) return null;
  return (
    <BuiButton disabled={team.busy} onClick={() => team.ask(subject)}>
      <Trans>Ask the team</Trans>
    </BuiButton>
  );
}
