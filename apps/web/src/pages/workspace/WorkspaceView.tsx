import { Trans, useLingui } from "@lingui/react/macro";
import type { WorkspaceOverview, WorkspaceSummary } from "@rakazo/contracts";
import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { rpc } from "../../lib/rpc";
import { isSectionKey, Loading, type SectionKey } from "./bits";
import { PipelineMap } from "./PipelineMap";
import { EmailPanel } from "./panels/EmailPanel";
import { LeasingPanel } from "./panels/LeasingPanel";
import { ReportsPanel } from "./panels/ReportsPanel";
import { SkillsPanel } from "./panels/SkillsPanel";
import { SocialPanel } from "./panels/SocialPanel";
import { SystemPanel } from "./panels/SystemPanel";
import { TeamPanel } from "./panels/TeamPanel";
import { UtilitiesPanel } from "./panels/UtilitiesPanel";
import { VoicePanel } from "./panels/VoicePanel";
import { railSections, useSectionLabels, WorkspaceRail } from "./WorkspaceRail";

/**
 * The Workspace place: the client's pipeline map as a canvas, a rail of
 * sections on the right, and one section panel at a time sliding over the
 * canvas. The open section lives in the URL so a reload lands on it.
 */
export function WorkspaceView() {
  const { t } = useLingui();
  const labels = useSectionLabels();
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState<WorkspaceSummary | null | undefined>(undefined);
  const [overview, setOverview] = useState<WorkspaceOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sectionParam = searchParams.get("section");
  const section: SectionKey | null = isSectionKey(sectionParam) ? sectionParam : null;

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

  const openSection = useCallback(
    (next: SectionKey | null) => {
      setSearchParams(
        (current) => {
          const params = new URLSearchParams(current);
          if (next) params.set("section", next);
          else params.delete("section");
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // Keyboard users land inside the drawer when it opens.
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (section) closeButtonRef.current?.focus();
  }, [section]);

  useEffect(() => {
    if (!section) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") openSection(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [section, openSection]);

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

  const sections = railSections(status);
  const activeSection = section && sections.includes(section) ? section : null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0D0D0E]">
      <div className="flex items-center justify-between border-b border-[#141416] px-[22px] py-[13px]">
        <div className="flex min-w-0 items-center gap-3">
          <span className="text-[16px] font-medium tracking-[0.01em] text-[#ECECEE]">
            <Trans>Workspace</Trans>
          </span>
          <span className="truncate text-[13px] text-[#6E6975]">{status.name}</span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <div className="rk-scroll h-full overflow-y-auto px-[22px] py-5">
            {error ? (
              <p className="text-[13px] text-[#E8A33C]">{error}</p>
            ) : overview ? (
              <PipelineMap overview={overview} onOpen={openSection} />
            ) : (
              <Loading />
            )}
          </div>

          {activeSection ? (
            <div
              className="absolute inset-0 z-20 flex justify-end bg-[rgba(4,4,5,.6)]"
              onPointerDown={() => openSection(null)}
            >
              <section
                role="dialog"
                aria-modal="false"
                aria-label={labels[activeSection]}
                data-testid="workspace-panel"
                onPointerDown={(event) => event.stopPropagation()}
                className="rk-scroll h-full w-full max-w-[780px] overflow-y-auto border-l border-[#202023] bg-[#0F0F11] px-5 py-4 shadow-[-24px_0_60px_rgba(0,0,0,.5)]"
              >
                <div className="mb-2 flex justify-end">
                  <button
                    ref={closeButtonRef}
                    type="button"
                    aria-label={t`Close`}
                    onClick={() => openSection(null)}
                    className="grid h-7 w-7 place-items-center rounded-full text-[#85858A] hover:bg-[#1A1A1D] hover:text-[#ECECEE]"
                  >
                    <X size={15} strokeWidth={1.8} />
                  </button>
                </div>
                <SectionPanel
                  key={activeSection}
                  section={activeSection}
                  overview={overview}
                  overviewError={error}
                  onOverviewChanged={load}
                />
              </section>
            </div>
          ) : null}
        </div>
        <WorkspaceRail
          sections={sections}
          active={activeSection}
          onSelect={(next) => openSection(next === activeSection ? null : next)}
        />
      </div>
    </div>
  );
}

function SectionPanel({
  section,
  overview,
  overviewError,
  onOverviewChanged,
}: {
  section: SectionKey;
  overview: WorkspaceOverview | null;
  overviewError: string | null;
  onOverviewChanged: () => Promise<void>;
}) {
  switch (section) {
    case "voice":
      return <VoicePanel />;
    case "reports":
      return <ReportsPanel />;
    case "email":
      return <EmailPanel />;
    case "social":
      return <SocialPanel />;
    case "leasing":
      return <LeasingPanel />;
    case "utilities":
      return <UtilitiesPanel />;
    case "team":
      return <TeamPanel overview={overview} error={overviewError} onRefresh={onOverviewChanged} />;
    case "skills":
      return <SkillsPanel />;
    case "system":
      return <SystemPanel />;
  }
}
