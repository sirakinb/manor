import { Trans, useLingui } from "@lingui/react/macro";
import type { WorkspaceOverview, WorkspaceSummary } from "@rakazo/contracts";
import { Settings } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { rpc } from "../../lib/rpc";
import { isSectionKey, Loading, type SectionKey } from "./bits";
import { Overview } from "./Overview";
import { EmailSection } from "./sections/EmailSection";
import { LeasingSection } from "./sections/LeasingSection";
import { ReportsSection } from "./sections/ReportsSection";
import { SettingsSection } from "./sections/SettingsSection";
import { SkillsSection } from "./sections/SkillsSection";
import { SocialSection } from "./sections/SocialSection";
import { SystemSection } from "./sections/SystemSection";
import { TeamSection } from "./sections/TeamSection";
import { UtilitiesSection } from "./sections/UtilitiesSection";
import { VoiceSection } from "./sections/VoiceSection";

export type WorkspaceTab = "overview" | SectionKey;

/** Which tabs a workspace shows: Overview, its channels, and the always-on four. */
export function workspaceTabs(workspace: WorkspaceSummary): WorkspaceTab[] {
  const has = (channel: WorkspaceSummary["channels"][number]) =>
    workspace.channels.includes(channel);
  const tabs: WorkspaceTab[] = ["overview"];
  if (has("voice")) tabs.push("voice");
  tabs.push("reports");
  if (has("email")) tabs.push("email");
  if (has("social")) tabs.push("social");
  if (has("leasing")) tabs.push("leasing");
  if (has("utilities")) tabs.push("utilities");
  tabs.push("team", "skills", "system");
  return tabs;
}

export function workspacePath(tab: WorkspaceTab, detailId?: string): string {
  if (tab === "overview") return "/app/workspace";
  return detailId ? `/app/workspace/${tab}/${detailId}` : `/app/workspace/${tab}`;
}

/**
 * The Workspace place: Manor's CRM header and tab bar over the client's
 * operations warehouse. The Overview tab is the pipeline map; every other
 * tab takes the whole pane, with detail screens on their own routes.
 */
export function WorkspaceView({
  organizationName = null,
}: {
  /** The current organization, passed only when the user belongs to several. */
  organizationName?: string | null;
}) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const splat = useParams()["*"] ?? "";
  const [first, second] = splat.split("/").filter(Boolean);
  const settingsOpen = first === "settings";
  const tab: WorkspaceTab | null =
    !first || settingsOpen ? "overview" : isSectionKey(first) ? first : null;
  const detailId = second;

  const [status, setStatus] = useState<WorkspaceSummary | null | undefined>(undefined);
  const [overview, setOverview] = useState<WorkspaceOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { workspace } = await rpc.workspace.status();
      setStatus(workspace);
      if (!workspace) return;
      setOverview(await rpc.workspace.overview());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t`Could not load the workspace`);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const labels: Record<WorkspaceTab, string> = {
    overview: t`Overview`,
    voice: t`Voice`,
    reports: t`Reports`,
    email: t`Email`,
    social: t`Social`,
    leasing: t`Leasing`,
    utilities: t`Utilities`,
    team: t`AI team`,
    skills: t`Skills`,
    system: t`System`,
  };

  // A failed status read is not "no workspace": say so instead of the empty line.
  if (status === undefined && error) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-[#0D0D0E]">
        <p className="px-[22px] py-6 text-[13px] text-[#E8A33C]">{error}</p>
      </div>
    );
  }
  if (status === undefined) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-[#0D0D0E] px-[22px]">
        <Loading />
      </div>
    );
  }
  if (status === null) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-[#0D0D0E]">
        <p className="px-[22px] py-6 text-[13px] text-[#6E6975]">
          <Trans>No workspace is connected to this account.</Trans>
        </p>
      </div>
    );
  }

  const tabs = workspaceTabs(status);
  if (!tab || !tabs.includes(tab)) return <Navigate to="/app/workspace" replace />;

  const open = (next: WorkspaceTab, id?: string) => navigate(workspacePath(next, id));
  const eyebrow = `${status.name} · ${settingsOpen ? t`Settings` : labels[tab]}`;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0D0D0E]">
      <div className="flex items-center justify-between border-b border-[#141416] px-[22px] py-[13px]">
        <div className="flex min-w-0 items-center gap-5">
          <span className="flex min-w-0 flex-col">
            <span className="flex min-w-0 items-baseline gap-2 text-[16px] font-medium tracking-[0.01em] text-[#ECECEE]">
              <Trans>Workspace</Trans>
              <span className="truncate text-[13px] font-normal text-[#6E6975]">
                · {status.name}
              </span>
            </span>
            {organizationName ? (
              <span className="truncate text-[11px] text-[#6E6975]">{organizationName}</span>
            ) : null}
          </span>
          <div
            data-testid="workspace-tabs"
            className="rk-scroll flex min-w-0 items-center gap-1 overflow-x-auto rounded-full border border-[#202023] bg-[#131315] p-1"
          >
            {tabs.map((entry) => (
              <button
                key={entry}
                type="button"
                aria-current={tab === entry && !settingsOpen ? "page" : undefined}
                onClick={() => open(entry)}
                className={`shrink-0 cursor-pointer rounded-full px-3.5 py-1 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--rk-accent)] ${
                  tab === entry && !settingsOpen
                    ? "bg-[#232326] text-[#ECECEE]"
                    : "text-[#85858A] hover:text-[#C9C9CE]"
                }`}
              >
                {labels[entry]}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-label={t`Workspace settings`}
            aria-current={settingsOpen ? "page" : undefined}
            onClick={() => navigate("/app/workspace/settings")}
            className={`grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--rk-accent)] ${
              settingsOpen
                ? "bg-[#232326] text-[#ECECEE]"
                : "text-[#85858A] hover:bg-[#131315] hover:text-[#C9C9CE]"
            }`}
          >
            <Settings size={15} strokeWidth={1.7} />
          </button>
        </div>
      </div>

      {settingsOpen ? (
        <div className="rk-scroll min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1180px] px-[22px] py-5">
            <SettingsSection workspace={status} eyebrow={eyebrow} />
          </div>
        </div>
      ) : tab === "overview" ? (
        <div className="min-h-0 flex-1">
          {error ? (
            <p className="px-[22px] py-6 text-[13px] text-[#E8A33C]">{error}</p>
          ) : overview ? (
            <Overview overview={overview} onOpen={open} />
          ) : (
            <div className="px-[22px]">
              <Loading />
            </div>
          )}
        </div>
      ) : (
        <div className="rk-scroll min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1180px] px-[22px] py-5">
            {tab === "voice" ? (
              <VoiceSection workspace={status} eyebrow={eyebrow} callId={detailId} onOpen={open} />
            ) : tab === "reports" ? (
              <ReportsSection
                workspace={status}
                eyebrow={eyebrow}
                reportId={detailId}
                onOpen={open}
              />
            ) : tab === "email" ? (
              <EmailSection workspace={status} eyebrow={eyebrow} />
            ) : tab === "social" ? (
              <SocialSection workspace={status} eyebrow={eyebrow} />
            ) : tab === "leasing" ? (
              <LeasingSection workspace={status} eyebrow={eyebrow} />
            ) : tab === "utilities" ? (
              <UtilitiesSection workspace={status} eyebrow={eyebrow} />
            ) : tab === "team" ? (
              <TeamSection
                workspace={status}
                eyebrow={eyebrow}
                overview={overview}
                error={error}
                onRefresh={load}
              />
            ) : tab === "skills" ? (
              <SkillsSection workspace={status} eyebrow={eyebrow} />
            ) : (
              <SystemSection workspace={status} eyebrow={eyebrow} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
