import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type { ComputerStatus } from "@rakazo/contracts";

export function DesktopKindEmptyState({ className }: { className?: string }) {
  return (
    <div className={className}>
      <Trans>
        This bot runs on this computer, not a Linux desktop. Shell and files use your home folder.
      </Trans>
    </div>
  );
}

/** Manor: a bot on "This Mac" works in a shared folder, so there is no screen to show. */
export function LocalFolderEmptyState({ className }: { className?: string }) {
  return (
    <div className={className}>
      <Trans>This bot is using a shared folder on this laptop. Files and shell only.</Trans>
    </div>
  );
}

export function computerPlaceholder(
  state: ComputerStatus["state"] | undefined,
  booting: boolean,
  label: string,
) {
  if (state === "booting" || booting) return t`Booting live desktop…`;
  if (state === "running") return label;
  if (state === "suspended") return t`Computer is asleep. Open it to wake.`;
  if (state === "error") return t`Computer failed to boot`;
  return t`Computer is stopped`;
}

export function computerLabel(mode: ComputerStatus["mode"] | undefined, botName: string) {
  if (mode === "local") return t`Shared folder on this Mac`;
  return mode === "dedicated" ? t`${botName}’s computer` : t`Team Computer`;
}
