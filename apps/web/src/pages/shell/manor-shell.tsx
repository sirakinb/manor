import { Trans, useLingui } from "@lingui/react/macro";
import { useTimeout } from "@rakazo/chat-ui/hooks";
import type {
  Bot,
  ComputerStatus,
  Me,
  ProductEvent,
  Space,
  ThreadSnapshot,
  WorkspaceSummary,
} from "@rakazo/contracts";
import { attachmentMaxCount } from "@rakazo/contracts";
import type { WorkspaceFilesController } from "@rakazo/core";
import { displayName, isActive } from "@rakazo/core";
import { bestEffort } from "@rakazo/logging/best-effort";
import { Button } from "@rakazo/ui-web";
import {
  BookOpen,
  FolderTree,
  Globe,
  LayoutGrid,
  ListFilter,
  Maximize2,
  Paperclip,
  Waypoints,
} from "lucide-react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NavigateFunction } from "react-router-dom";
import { useLocation, useParams } from "react-router-dom";
import { IconTooltip } from "../../components/IconTooltip";
import { accentColor } from "../../lib/brand";
import { composerPrefillFromState } from "../../lib/composer-prefill";
import { framablePreviewUrl } from "../../lib/computers/computer-screen";
import { lazyComponent } from "../../lib/platform/preload-recovery";
import type { RpcClient } from "../../lib/query/rpc";
import { selectedSpaceId } from "../../lib/query/rpc";
import { useEventListener } from "../../lib/use-event-listener";
import { useFileDropZone } from "../../lib/use-file-drop";
import type { Panel } from "./right-panel-state";

/*
 * Manor's additions to the shell: its places (Workspace, CRM, docs), the live activity feed, the
 * app preview, and the files and run-log panels. Kept beside upstream's shell modules so Shell.tsx
 * stays upstream's shape.
 */

// Manor: its places and side panels load when opened, so they stay out of the startup bundle.
const WorkspaceView = lazyComponent(() =>
  import("../workspace/WorkspaceView").then((module) => module.WorkspaceView),
);
const CrmView = lazyComponent(() => import("../crm/CrmView").then((module) => module.CrmView));
const DocsView = lazyComponent(() => import("../DocsView").then((module) => module.DocsView));
const FilesPanel = lazyComponent(() =>
  import("../../components/FilesPanel").then((module) => module.FilesPanel),
);
const RunLogsPanel = lazyComponent(() =>
  import("../../components/RunLogsPanel").then((module) => module.RunLogsPanel),
);

/**
 * The CRM, docs and Workspace are places, not panels, so they live on their own routes and win the
 * main pane whenever the address says so.
 */
export function useManorPlaces(rpc: RpcClient) {
  const { pathname } = useLocation();
  const crmOpen = pathname === "/app/crm";
  const docsOpen = pathname === "/app/docs";
  const workspaceOpen = pathname === "/app/workspace" || pathname.startsWith("/app/workspace/");
  // The Workspace place exists only for accounts with a connected warehouse;
  // one cheap status read on mount decides whether the nav shows it.
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null);
  useEffect(() => {
    rpc.workspace
      .status()
      .then((result) => setWorkspace(result.workspace))
      .catch(() => setWorkspace(null));
  }, []);
  return {
    crmOpen,
    docsOpen,
    workspaceOpen,
    placeOpen: crmOpen || docsOpen || workspaceOpen,
    workspace,
  };
}

export type ManorPlaces = ReturnType<typeof useManorPlaces>;

/**
 * Manor's shell state that upstream's hooks need early: the open place, the live activity feed
 * (the thread sync records into it) and the organization the sidebar names.
 */
export function useManorShellState(
  rpc: RpcClient,
  activeId: string | undefined,
  spaces: Space[],
  spaceId: string | undefined,
) {
  const places = useManorPlaces(rpc);
  const liveActivity = useLiveActivity(activeId);
  // Navigation contains only the account's organization for this portal.
  const organizationName = useMemo(() => {
    const currentSpaceId = selectedSpaceId() ?? spaceId;
    // An unreadable legacy organization name is hidden rather than printed raw.
    const name = spaces.find((space) => space.id === currentSpaceId)?.organizationName;
    return displayName(name, "") || null;
  }, [spaces, spaceId]);
  return { places, liveActivity, organizationName };
}

export type ManorShellState = ReturnType<typeof useManorShellState>;

/** What Manor adds to the shell's sidebar, chat column, header, composer, transcript and panel. */
export function useManorShellProps({
  rpc,
  manor,
  sidebar,
  roster,
  rightPanel: { panel, setPanel },
  inGroup,
  active,
  activeGroup,
  thread: { snapshot },
  view: { activeSnapshot, transcriptProps },
  computerState: { computer },
  computerControls,
  composer: { onAttachmentPick },
  recordingSkill,
  refreshThread,
  navigate,
  setMobileSidebarOpen,
  setOverlay,
}: {
  rpc: RpcClient;
  manor: ManorShellState;
  sidebar: { mini: boolean };
  roster: { bootstrapMe: Me | null | undefined; setBots: Dispatch<SetStateAction<Bot[]>> };
  rightPanel: { panel: Panel; setPanel: (panel: Panel) => void };
  inGroup: boolean;
  active: Bot | undefined;
  activeGroup: { name: string } | undefined;
  thread: { snapshot: ThreadSnapshot | null };
  view: { activeSnapshot: ThreadSnapshot | null; transcriptProps: { running: boolean } };
  computerState: { computer: ComputerStatus | null };
  computerControls: { openComputer: () => Promise<unknown> };
  composer: {
    onAttachmentPick: (files: FileList | readonly File[] | null, threadKey?: string) => unknown;
  };
  recordingSkill: unknown;
  refreshThread: (botId: string) => Promise<unknown>;
  navigate: NavigateFunction;
  setMobileSidebarOpen: (open: boolean) => void;
  setOverlay: (overlay: { kind: "integrations" }) => void;
}) {
  const mini = sidebar.mini;
  const { bootstrapMe: me, setBots } = roster;
  const running = transcriptProps.running;
  const hasChat = Boolean(active || activeGroup);
  const activeName = inGroup ? (activeGroup?.name ?? activeSnapshot?.groupName) : active?.name;
  const openComputer = () => void computerControls.openComputer();
  const closeMobileSidebar = () => setMobileSidebarOpen(false);
  const openIntegrations = () => setOverlay({ kind: "integrations" });
  const { t } = useLingui();
  const location = useLocation();
  const { botId } = useParams();
  const { places, liveActivity, organizationName } = manor;
  const fileControllers = useFileControllers();
  const preview = useAppPreview({ rpc, panel, setPanel, active, snapshot, computer });
  // Manor takes file drops on the whole chat pane, not just the composer.
  const paneDrop = useFileDropZone<HTMLDivElement>({
    disabled: Boolean(recordingSkill) || !hasChat,
    onFiles: (files) => void onAttachmentPick(files),
  });
  return {
    rosterLabel:
      organizationName && !mini ? (
        <p className="truncate px-2.5 pt-3 pb-0.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[#6E6975]">
          {organizationName}
        </p>
      ) : null,
    sidebarPlaces: (
      <ManorPlaceNav
        places={places}
        mini={mini}
        navigate={(path) => {
          closeMobileSidebar();
          navigate(path);
        }}
        openIntegrations={openIntegrations}
      />
    ),
    chatColumn: {
      place: places.placeOpen ? (
        <ManorPlaceView
          places={places}
          organizationName={organizationName}
          onOpenBot={(bot, text) => {
            setBots((current) =>
              current.some((candidate) => candidate.id === bot.id) ? current : [...current, bot],
            );
            navigate(`/app/${bot.id}`, { state: { composerPrefill: { botId: bot.id, text } } });
          }}
        />
      ) : undefined,
      drop: {
        dragging: paneDrop.dragging,
        handlers: paneDrop.handlers,
        overlay: (
          <FileDropOverlay
            name={activeName ?? (inGroup ? t`this group` : t`this bot`)}
            maxCount={attachmentMaxCount(me)}
          />
        ),
      },
    },
    header: {
      leadingActions: (
        <LiveActivityButton
          shown={liveActivity.showActivity}
          onToggle={liveActivity.toggleActivity}
        />
      ),
      trailingActions: (
        <ManorChatHeaderActions
          inGroup={inGroup}
          active={active}
          panel={panel}
          setPanel={setPanel}
        />
      ),
    },
    composer: {
      prefill: inGroup
        ? undefined
        : composerPrefillFromState(location.state, location.key, botId, active?.id),
      onPrefillConsumed: () =>
        navigate(`${location.pathname}${location.search}`, { replace: true, state: null }),
      onOpenRunLogs: !inGroup && active ? () => setPanel("logs") : undefined,
    },
    transcript: {
      liveRun: liveRunOf(activeSnapshot, activeName ?? ""),
      activityFeed: (
        <LiveActivityFeed
          activity={liveActivity.activity}
          shown={liveActivity.showActivity}
          runId={snapshot?.run?.id}
        />
      ),
      onOpenPreview: preview.openPreview,
    },
    sidePanel: {
      localComputer: me?.localComputer,
      manorTitle: <ManorPanelTitle panel={panel} />,
      manorHeaderActions: active ? (
        <ManorPanelActions
          panel={panel}
          setPanel={setPanel}
          hasPreview={Boolean(preview.activePreview)}
          onExpandComputer={openComputer}
        />
      ) : null,
      manorContent: active ? (
        <ManorPanelContent
          rpc={rpc}
          panel={panel}
          active={active}
          computer={computer}
          running={running}
          fileControllers={fileControllers}
          preview={preview}
          onAttach={(file, id) => onAttachmentPick([file], id)}
          refreshThread={refreshThread}
        />
      ) : null,
    },
  };
}

/** Manor's places and Integrations, above upstream's account footer. */
export function ManorPlaceNav({
  places,
  mini,
  navigate,
  openIntegrations,
}: {
  places: ManorPlaces;
  mini: boolean;
  navigate: (path: string) => void;
  openIntegrations: () => void;
}) {
  const { t } = useLingui();
  return (
    <div className={mini ? "flex flex-col items-center" : "contents"}>
      {places.workspace ? (
        <ManorNavRow
          mini={mini}
          label={t`Workspace`}
          icon={<Waypoints size={15} strokeWidth={1.7} />}
          active={places.workspaceOpen}
          onClick={() => navigate("/app/workspace")}
        />
      ) : null}
      <ManorNavRow
        mini={mini}
        label="CRM"
        icon={<CrmIcon />}
        active={places.crmOpen}
        onClick={() => navigate("/app/crm")}
      />
      <ManorNavRow
        mini={mini}
        label={t`Integrations`}
        icon={<LayoutGrid size={15} strokeWidth={1.7} />}
        onClick={openIntegrations}
      />
      <ManorNavRow
        mini={mini}
        label={t`Documentation`}
        icon={<BookOpen size={15} strokeWidth={1.7} />}
        active={places.docsOpen}
        onClick={() => navigate("/app/docs")}
      />
    </div>
  );
}

/** The open place in the main pane, or null when the pane shows a chat. */
export function ManorPlaceView({
  places,
  organizationName,
  onOpenBot,
}: {
  places: ManorPlaces;
  organizationName: string | null;
  onOpenBot: (bot: Bot, text: string) => void;
}) {
  if (places.workspaceOpen) {
    return (
      <Suspense fallback={null}>
        <WorkspaceView organizationName={organizationName} onOpenBot={onOpenBot} />
      </Suspense>
    );
  }
  if (places.crmOpen) {
    return (
      <Suspense fallback={null}>
        <CrmView />
      </Suspense>
    );
  }
  if (places.docsOpen) {
    return (
      <Suspense fallback={null}>
        <DocsView />
      </Suspense>
    );
  }
  return null;
}

type ActivityItem = { id: string; runId: string; name: string; detail: string };

/** Manor's live activity feed: the open bot's tool calls in the current run. */
export function useLiveActivity(activeId: string | undefined) {
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [showActivity, setShowActivity] = useState(
    () => window.localStorage.getItem("manor.showActivity") !== "0",
  );
  const toggleActivity = useCallback(() => {
    setShowActivity((prev) => {
      window.localStorage.setItem("manor.showActivity", prev ? "0" : "1");
      return !prev;
    });
  }, []);
  useEffect(() => setActivity([]), [activeId]);
  const recordActivity = useCallback((event: ProductEvent) => {
    if (event.type !== "agent.tool.called" || !event.runId) return;
    const payload = event.payload as { name?: string; executionId?: string; detail?: string };
    const runId = event.runId;
    const entry = {
      id: `${runId}:${payload.executionId ?? event.seq}`,
      runId,
      name: payload.name ?? "tool",
      detail: payload.detail ?? "",
    };
    setActivity((prev) => {
      const scoped = prev.filter((item) => item.runId === entry.runId);
      if (scoped.some((item) => item.id === entry.id)) return prev;
      return [...scoped, entry].slice(-40);
    });
  }, []);
  return { activity, showActivity, toggleActivity, recordActivity };
}

export function LiveActivityButton({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  const { t } = useLingui();
  const label = shown ? t`Hide live activity` : t`Show live activity`;
  return (
    <IconTooltip label={label}>
      <Button
        variant="floating"
        size="icon-lg"
        aria-label={label}
        aria-pressed={shown}
        onClick={onToggle}
        className="app-no-drag"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke={shown ? accentColor : "currentColor"}
          strokeWidth="1.6"
          aria-hidden="true"
        >
          <path d="M2 12h4l3-8 4 16 3-8h6" />
        </svg>
      </Button>
    </IconTooltip>
  );
}

export function LiveActivityFeed({
  activity,
  shown,
  runId,
}: {
  activity: ActivityItem[];
  shown: boolean;
  runId: string | undefined;
}) {
  const items = activity.filter((item) => item.runId === runId);
  if (!shown || items.length === 0) return null;
  return (
    <div className="w-full max-w-[560px] rounded-[16px] border border-[#1F1B29] bg-[#0C0B10] px-4 py-3">
      <div className="rk-label mb-2 text-[10.5px] text-[#6E6975]">
        <Trans>Activity</Trans>
      </div>
      <div className="flex flex-col gap-[7px]">
        {items.map((item, index) => (
          <div
            key={item.id}
            className="flex items-baseline gap-2.5 font-mono text-[12.5px]"
            style={
              index === items.length - 1
                ? { animation: "rkPulse 1.2s ease-in-out infinite" }
                : undefined
            }
          >
            <span className="shrink-0 text-[var(--rk-accent)]">{item.name}</span>
            {item.detail ? <span className="truncate text-[#6E6975]">{item.detail}</span> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The transcript's live run line: who is working and since when. */
export function liveRunOf(
  snapshot: ThreadSnapshot | null,
  name: string,
): { startedAt: string | null; name: string } | undefined {
  return snapshot?.run && isActive(snapshot.run.status)
    ? { startedAt: snapshot.run.startedAt, name }
    : undefined;
}

/** The chat header's Run logs and Files buttons, for a bot's chat. */
export function ManorChatHeaderActions({
  inGroup,
  active,
  panel,
  setPanel,
}: {
  inGroup: boolean;
  active: Bot | undefined;
  panel: Panel;
  setPanel: (panel: Panel) => void;
}) {
  const { t } = useLingui();
  if (inGroup) return null;
  return (
    <>
      {active ? (
        <IconTooltip label={t`Run logs`}>
          <Button
            variant="floating"
            size="icon-lg"
            aria-label={t`Run logs`}
            aria-pressed={panel === "logs"}
            data-testid="run-logs-trigger"
            onClick={() => setPanel(panel === "logs" ? null : "logs")}
            className="app-no-drag"
          >
            <ListFilter strokeWidth={1.6} className="size-[18px]" />
          </Button>
        </IconTooltip>
      ) : null}
      <IconTooltip label={t`Files`}>
        <Button
          variant="floating"
          size="icon-lg"
          aria-label={t`Files`}
          aria-pressed={panel === "files"}
          data-testid="files-trigger"
          onClick={() => setPanel(panel === "files" ? null : "files")}
          className="app-no-drag"
        >
          <FolderTree strokeWidth={1.6} className="size-[18px]" />
        </Button>
      </IconTooltip>
    </>
  );
}

type PreviewTarget = {
  botId: string;
  messageId: string;
  port: number;
  path?: string;
  title?: string;
};

/** Manor's app preview: a bot's share_preview opens it beside the chat, on the primary host. */
export function useAppPreview({
  rpc,
  panel,
  setPanel,
  active,
  snapshot,
  computer,
}: {
  rpc: RpcClient;
  panel: Panel;
  setPanel: (panel: Panel) => void;
  active: Bot | undefined;
  snapshot: ThreadSnapshot | null;
  computer: ComputerStatus | null;
}) {
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const lastPreviewMessage = useRef<string | null>(null);
  const activePreview = active && previewTarget?.botId === active.id ? previewTarget : null;
  // Mint a fresh signed preview link while the pane is open; links expire after an hour.
  const minting = panel === "preview" && activePreview !== null && computer?.state === "running";
  const [mintRound, setMintRound] = useState(0);
  useTimeout(() => setMintRound((round) => round + 1), minting ? 45 * 60_000 : null, mintRound);
  useEffect(() => {
    if (!minting || !activePreview) {
      setPreviewUrl(null);
      return;
    }
    let cancelled = false;
    void rpc.computer
      .previewUrl({
        botId: activePreview.botId,
        port: activePreview.port,
        ...(activePreview.path ? { path: activePreview.path } : {}),
      })
      .then((result) => {
        if (!cancelled) setPreviewUrl(result.url);
      })
      .catch(() => {
        if (!cancelled) setPreviewUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [minting, activePreview, mintRound]);
  // A bot calling share_preview opens the pane; older previews stay one click away.
  useEffect(() => {
    const messages = snapshot?.messages;
    if (!messages || !active || (snapshot?.botId && snapshot.botId !== active.id)) return;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]!;
      if (message.role !== "bot") continue;
      const block = message.blocks.find((item) => item.kind === "preview");
      if (block?.kind !== "preview") continue;
      if (lastPreviewMessage.current === message.id) return;
      lastPreviewMessage.current = message.id;
      setPreviewTarget({
        botId: active.id,
        messageId: message.id,
        port: block.port,
        ...(block.path ? { path: block.path } : {}),
        ...(block.title ? { title: block.title } : {}),
      });
      if (Date.now() - new Date(message.createdAt).getTime() < 5 * 60_000) setPanel("preview");
      return;
    }
  }, [snapshot?.messages, snapshot?.botId, active]);
  const openPreview = useCallback(
    (block: { port: number; path?: string; title?: string }, messageId: string) => {
      if (!active) return;
      lastPreviewMessage.current = messageId;
      setPreviewTarget({
        botId: active.id,
        messageId,
        port: block.port,
        ...(block.path ? { path: block.path } : {}),
        ...(block.title ? { title: block.title } : {}),
      });
      setPanel("preview");
    },
    [active],
  );
  return {
    activePreview,
    previewUrl,
    framedPreviewUrl: framablePreviewUrl(previewUrl, window.location.href),
    openPreview,
  };
}

export type AppPreview = ReturnType<typeof useAppPreview>;

/**
 * Keep unsaved drafts when a panel closes or the user switches bots, scoped to this signed-in
 * shell. FilesPanel makes each controller when first opened, so its code loads with the panel.
 */
export function useFileControllers() {
  const fileControllers = useRef(new Map<string, WorkspaceFilesController>());
  useEventListener(window, "beforeunload", (event) => {
    if ([...fileControllers.current.values()].some((controller) => controller.dirty)) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  return fileControllers.current;
}

/**
 * Manor titles its own panels; upstream's only title is a group's. The computer is a section of
 * the bot's panel, which has its own header.
 */
export function ManorPanelTitle({ panel }: { panel: Panel }) {
  if (panel !== "preview" && panel !== "files" && panel !== "logs") return null;
  return (
    <span className="text-[13.5px] text-muted-foreground">
      {panel === "preview" ? (
        <Trans>Preview</Trans>
      ) : panel === "files" ? (
        <Trans>Files</Trans>
      ) : (
        <Trans>Run logs</Trans>
      )}
    </span>
  );
}

/** The bot panel's header buttons: expand the computer, run logs, preview and files. */
export function ManorPanelActions({
  panel,
  setPanel,
  hasPreview,
  onExpandComputer,
}: {
  panel: Panel;
  setPanel: (panel: Panel) => void;
  hasPreview: boolean;
  onExpandComputer: () => void;
}) {
  const { t } = useLingui();
  return (
    <>
      {panel === "settings" ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t`Expand computer`}
          onClick={onExpandComputer}
          className="text-muted-foreground"
        >
          <Maximize2 size={16} strokeWidth={1.7} />
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={panel === "logs" ? t`Show computer` : t`Run logs`}
        onClick={() => setPanel(panel === "logs" ? "settings" : "logs")}
        className={panel === "logs" ? "text-foreground" : "text-muted-foreground"}
      >
        <ListFilter size={16} strokeWidth={1.7} />
      </Button>
      {hasPreview ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={panel === "preview" ? t`Show computer` : t`Show preview`}
          onClick={() => setPanel(panel === "preview" ? "settings" : "preview")}
          className={panel === "preview" ? "text-foreground" : "text-muted-foreground"}
        >
          <Globe size={16} strokeWidth={1.7} />
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={panel === "files" ? t`Show computer` : t`Show files`}
        onClick={() => setPanel(panel === "files" ? "settings" : "files")}
        className={panel === "files" ? "text-foreground" : "text-muted-foreground"}
      >
        <FolderTree size={16} strokeWidth={1.7} />
      </Button>
    </>
  );
}

/** The run logs, files and app preview panels, each loaded when first opened. */
export function ManorPanelContent({
  rpc,
  panel,
  active,
  computer,
  running,
  fileControllers,
  preview,
  onAttach,
  refreshThread,
}: {
  rpc: RpcClient;
  panel: Panel;
  active: Bot;
  computer: ComputerStatus | null;
  running: boolean;
  fileControllers: Map<string, WorkspaceFilesController>;
  preview: AppPreview;
  onAttach: (file: File, botId: string) => void;
  refreshThread: (botId: string) => Promise<unknown>;
}) {
  const { t } = useLingui();
  const { activePreview, previewUrl, framedPreviewUrl } = preview;
  const controllerKey = `${active.id}:${computer?.mode ?? "team"}`;
  return (
    <Suspense fallback={null}>
      {panel === "logs" ? <RunLogsPanel key={active.id} botId={active.id} /> : null}
      {panel === "files" ? (
        <FilesPanel
          key={controllerKey}
          controllers={fileControllers}
          controllerKey={controllerKey}
          botId={active.id}
          request={(request) => rpc.computer.workspace(request)}
          team={computer?.mode === "team"}
          computerState={computer?.state}
          running={running}
          onAttach={async (file) => {
            onAttach(file, active.id);
          }}
          onWake={() => {
            void bestEffort(
              "wake the computer for the files panel",
              rpc.computer.boot({ botId: active.id }).then(() => refreshThread(active.id)),
            );
          }}
        />
      ) : null}
      {panel === "preview" && activePreview ? (
        <div>
          <div
            data-testid="app-preview"
            className="relative aspect-[3/4] overflow-hidden rounded-[14px] bg-[#0E0E10]"
          >
            {computer?.state === "running" && framedPreviewUrl ? (
              <iframe
                title={activePreview.title || t`App preview`}
                src={framedPreviewUrl}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
                className="h-full w-full border-0 bg-white"
              />
            ) : (
              <div className="grid h-full place-items-center px-6 text-center text-sm text-[#6C6C70]">
                {computer?.state === "running" ? (
                  <Trans>Connecting to the preview…</Trans>
                ) : (
                  <Trans>Start the computer to load the preview.</Trans>
                )}
              </div>
            )}
          </div>
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="truncate text-[13.5px] text-[#85858A]" dir="auto">
              {activePreview.title || t`Port ${activePreview.port}`}
            </p>
            {previewUrl ? (
              <a
                href={previewUrl}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 text-[13px] text-[#A855F7] hover:underline"
              >
                <Trans>Open in new tab</Trans>
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
    </Suspense>
  );
}

/** Manor takes file drops on the whole chat pane, not just the composer. */
export function FileDropOverlay({ name, maxCount }: { name: string; maxCount: number }) {
  const { t } = useLingui();
  return (
    <div
      data-testid="file-drop-overlay"
      aria-hidden
      className="pointer-events-none absolute inset-0 z-40 p-3 md:p-4"
    >
      <div className="rk-drop-zone flex h-full w-full flex-col items-center justify-center gap-3 rounded-[22px]">
        <span className="grid h-12 w-12 place-items-center rounded-full border border-[#8B5CF6]/40 bg-[#8B5CF6]/15 text-[#C4B5FD]">
          <Paperclip size={20} strokeWidth={1.8} />
        </span>
        <span className="text-[16px] font-medium text-[#ECECEE]" dir="auto">
          {t`Drop to attach to ${name}`}
        </span>
        <span className="text-[13px] text-[#85858A]">
          {t`Images, PDFs and text files, up to ${maxCount}`}
        </span>
      </div>
    </div>
  );
}

/** One of Manor's sidebar rows for its places (Workspace, CRM, Docs) and Integrations. */
function ManorNavRow({
  mini,
  label,
  icon,
  active = false,
  onClick,
}: {
  mini: boolean;
  label: string;
  icon: ReactNode;
  active?: boolean;
  onClick: () => void;
}) {
  if (mini) {
    return (
      <IconTooltip label={label}>
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          className={`mb-1 grid size-10 place-items-center rounded-[11px] hover:bg-[#131315] ${
            active ? "bg-[#131315]" : ""
          }`}
        >
          <span className="grid h-[30px] w-[30px] place-items-center rounded-full bg-[#17171A] text-[#9A9AA0]">
            {icon}
          </span>
        </button>
      </IconTooltip>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={`mx-3 mb-1 flex items-center gap-3 rounded-[11px] px-2.5 py-2 hover:bg-[#131315] ${
        active ? "bg-[#131315]" : ""
      }`}
    >
      <span className="grid h-[30px] w-[30px] place-items-center rounded-full bg-[#17171A] text-[#9A9AA0]">
        {icon}
      </span>
      <span className="text-[14.5px] text-[#C9C9CE]">{label}</span>
    </button>
  );
}

function CrmIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
      <path d="M17.25 13.5v7.5M13.5 17.25h7.5" />
    </svg>
  );
}
