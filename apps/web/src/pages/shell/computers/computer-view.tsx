import { Trans } from "@lingui/react/macro";

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
