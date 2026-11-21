import { Trans, useLingui } from "@lingui/react/macro";
import type {
  AgentSkillCatalogEntry,
  Bot,
  ProductEvent,
  SpaceMemoryConfig,
  ThreadMessage,
  VoiceStatus,
  WorkspaceSummary,
} from "@rakazo/contracts";
import { ATTACHMENT_MAX_COUNT } from "@rakazo/contracts";
import type { AgentImportReader } from "@rakazo/core";
import {
  answerableAskMessageIds,
  channelMessageSender,
  chatUserBubbleColors,
  dismissableAskMessageIds,
  displayName,
  foldPeerReplies,
  isActive,
  isRunWorking,
  memberName,
  WorkspaceFilesController,
} from "@rakazo/core";
import { fetchFresh, writeSaved } from "@rakazo/core/query";
import type { GroupAvatarMember } from "@rakazo/ui-web";
import { Button } from "@rakazo/ui-web";
import { useIsMobile } from "@rakazo/ui-web/hooks/use-mobile";
import { useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  FolderTree,
  Globe,
  LayoutGrid,
  ListFilter,
  Maximize2,
  Paperclip,
  Plus,
  Waypoints,
} from "lucide-react";
import type { DragEvent, ReactNode } from "react";
import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useLocation, useParams } from "react-router-dom";
import { ComputerUpdateProgress } from "../components/ComputerUpdateProgress";
import { CallCard, CallReturnBar } from "../components/call/CallCard";
import { IncomingCall } from "../components/call/IncomingCall";
import { FilesPanel } from "../components/FilesPanel";
import { IconTooltip } from "../components/IconTooltip";
import { PageLoading } from "../components/PageLoading";
import { RunLogsPanel } from "../components/RunLogsPanel";
import type { CapturedDrop } from "../lib/agent-drop";
import { captureDrop } from "../lib/agent-drop";
import type { ArtifactTarget } from "../lib/artifact-open";
import { authClient } from "../lib/auth";
import { peekBootstrapSeed } from "../lib/bootstrap";
import type { BotsSidebarDensity } from "../lib/bots-sidebar-density-pref";
import {
  getBotsSidebarDensity,
  subscribeBotsSidebarDensity,
} from "../lib/bots-sidebar-density-pref";
import { readBotsSidebarCollapsed, writeBotsSidebarCollapsed } from "../lib/bots-sidebar-pref";
import { accentColor } from "../lib/brand";
import { setCallMinimized, startCall, useCallSession } from "../lib/call-session";
import {
  getComposerEnterToSend,
  subscribeComposerEnterToSend,
} from "../lib/composer-enter-to-send-pref";
import { composerPrefillFromState } from "../lib/composer-prefill";
import { framablePreviewUrl } from "../lib/computer-screen";
import { desktopBridge } from "../lib/desktop";
import { isFileDrag } from "../lib/pending-attachments";
import { markAfterPaint, markOnce } from "../lib/performance";
import { usePreloadRecoveryState } from "../lib/preload-recovery";
import { lastChatKey, lastChatOf, queryClient, spaceQueries, spaceSeedKey } from "../lib/query";
import { rightPanelStorageKey } from "../lib/right-panel-state";
import { createSpaceRpc, selectedSpaceId, selectSpace } from "../lib/rpc";
import { markShellReady, useSpaceEpoch } from "../lib/space-switch";
import { activeThreadRuns } from "../lib/thread-events";
import { useDesktopBadge } from "../lib/use-desktop-badge";
import { useFileDropZone } from "../lib/use-file-drop";
import { useTeamPresence } from "../lib/use-team-presence";
import { CrmView } from "./crm/CrmView";
import { DocsView } from "./DocsView";
import { HostComputerPrompt } from "./HostComputerPrompt";
import { ArchivedChats } from "./shell/archived-chats";
import { ChatContextMenu } from "./shell/chat-context-menu";
import { ChatHeader } from "./shell/chat-header";
import { FALLBACK_BOT_COLOR } from "./shell/chat-shared";
import { Composer } from "./shell/composer";
import { ComputerOverlay } from "./shell/computer-overlay";
import { ComputerPanel } from "./shell/computer-panel";
import type { CreateBotDialogInput } from "./shell/create-bot-dialog";
import { isPlaceRoute } from "./shell/place-routes";
import { ShellDialogs, useShellDialogs } from "./shell/shell-dialogs";
import { AppOverlays, SettingsOverlays } from "./shell/shell-overlays";
import { ShellSidebar } from "./shell/shell-sidebar";
import { ShellSidePanel } from "./shell/side-panel";
import { useCreateMenu } from "./shell/sidebar-header";
import { BotsSidebarLayout } from "./shell/sidebar-layout";
import { SidebarRoster } from "./shell/sidebar-roster";
import { commitSpaceRename, countUnreadChats, sidebarGroupsForSpaces } from "./shell/space-sidebar";
import { Transcript } from "./shell/transcript";
import { useBrowserNotifications } from "./shell/use-browser-notifications";
import { useChatRead } from "./shell/use-chat-read";
import { useComposerActions } from "./shell/use-composer-actions";
import { useComposerMentions } from "./shell/use-composer-mentions";
import { useComputerControls, useComputerState } from "./shell/use-computer";
import { useMessageJump } from "./shell/use-message-jump";
import { useMobileSidebar } from "./shell/use-mobile-sidebar";
import { useReadAloud } from "./shell/use-read-aloud";
import { useRightPanel, useRightPanelRestore } from "./shell/use-right-panel";
import { useRoutineEditor } from "./shell/use-routine-editor";
import { useShellNavigation } from "./shell/use-shell-navigation";
import { useSidebarExpansion } from "./shell/use-sidebar-expansion";
import { useSidebarSearch } from "./shell/use-sidebar-search";
import { useRosterDrop, useSpaceBootstrap, useSpaceRoster } from "./shell/use-space-roster";
import { useOpenSpaceChat } from "./shell/use-space-switch";
import { useThreadState } from "./shell/use-thread-state";
import { useThreadSync } from "./shell/use-thread-sync";
import type { SettingsSection } from "./shell-overlay";
import { WorkspaceView } from "./workspace/WorkspaceView";

const NO_AGENT_SKILLS: AgentSkillCatalogEntry[] = [];
const NO_PROVIDERS: string[] = [];

export function ShellPage() {
  useTeamPresence();
  // A new key per space switch, so nothing from the previous space survives it.
  const spaceEpoch = useSpaceEpoch();
  return <SpaceShell key={spaceEpoch} />;
}

function SpaceShell() {
  const { t } = useLingui();
  const { botId, groupId } = useParams();
  const [shellSpaceId] = useState(selectedSpaceId);
  const [rpc] = useState(() => createSpaceRpc(shellSpaceId));
  const session = authClient.useSession();
  const userId = session.data?.user.id;
  const [createMenuOpen, setCreateMenuOpen] = useCreateMenu();
  // A revisited space, or the shell reopened from another page, starts from what it showed
  // last time while its fresh bootstrap loads.
  const [{ seed, startChat }] = useState(() => {
    const primed = peekBootstrapSeed(botId);
    if (primed) return { seed: primed, startChat: undefined };
    const cached = queryClient.getQueryData(spaceSeedKey(userId ?? null, shellSpaceId));
    const lastChat = queryClient.getQueryData(lastChatKey(userId ?? null, shellSpaceId));
    // Manor's place routes (Workspace, CRM, docs) open there, not the last chat.
    const reopenChat = !botId && !groupId && !isPlaceRoute(window.location.pathname);
    return { seed: cached, startChat: reopenChat ? lastChatOf(cached, lastChat) : undefined };
  });
  const {
    navigate,
    navigationRevision,
    overlayRevision,
    alive,
    searchParams,
    setSearchParams,
    searchParamsRef,
    redirectKeepingOverlay,
    overlay,
    setOverlay,
  } = useShellNavigation();
  const queries = spaceQueries(userId ?? null, shellSpaceId);
  const roster = useSpaceRoster({ rpc, seed, botId, groupId, navigate, redirectKeepingOverlay });
  const {
    groups,
    setGroups,
    bots,
    setBots,
    botsRef,
    botSections,
    spaces,
    setSpaces,
    archivedBots,
    archivedGroups,
    initialBotsLoaded,
    initialLoadFailed,
    bootstrapMe,
    setBootstrapMe,
    refreshBots,
  } = roster;
  // The CRM, docs and Workspace are places, not panels, so they live on their own routes
  // and win the main pane whenever the address says so.
  const location = useLocation();
  const placePathname = location.pathname;
  const crmOpen = placePathname === "/app/crm";
  const docsOpen = placePathname === "/app/docs";
  const workspaceOpen =
    placePathname === "/app/workspace" || placePathname.startsWith("/app/workspace/");
  // The Workspace place exists only for accounts with a connected warehouse;
  // one cheap status read on mount decides whether the nav shows it.
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null);
  useEffect(() => {
    rpc.workspace
      .status()
      .then((result) => setWorkspace(result.workspace))
      .catch(() => setWorkspace(null));
  }, []);
  const { collapsedSidebarSections, toggleSidebarSection } = useSidebarExpansion(userId);
  const [botsSidebarCollapsed, setBotsSidebarCollapsed] = useState(false);
  useEffect(() => {
    setBotsSidebarCollapsed(readBotsSidebarCollapsed(userId));
  }, [userId]);
  const search = useSidebarSearch({ rpc, navigate });
  const thread = useThreadState();
  const { snapshot } = thread;
  // Manor's ActivityTimeline always shows thoughts and tool steps, so upstream's
  // "Show tool activity" preference is not read here and its settings toggle is hidden.
  const botsSidebarDensity = useSyncExternalStore<BotsSidebarDensity>(
    subscribeBotsSidebarDensity,
    getBotsSidebarDensity,
    () => "comfortable",
  );
  const enterToSend = useSyncExternalStore(
    subscribeComposerEnterToSend,
    getComposerEnterToSend,
    () => false,
  );
  const rightPanel = useRightPanel({ searchParams, setSearchParams });
  const { panel, setPanel, modelFocusRequest, setModelFocusRequest } = rightPanel;
  const [droppedAgent, setDroppedAgent] = useState<AgentImportReader | null>(null);
  // Back returns to the New bot dialog only when the import was opened from it.
  const [importFromDialog, setImportFromDialog] = useState(false);
  const [peerConversation, setPeerConversation] = usePreloadRecoveryState<{
    peerBotId: string;
    peerBotName: string;
  } | null>("peerConversation", null);
  const agentSkillsQuery = useQuery(queries.agentSkills.list.queryOptions());
  const agentSkills = agentSkillsQuery.data ?? NO_AGENT_SKILLS;
  const setAgentSkills = useCallback(
    (skills: AgentSkillCatalogEntry[]) =>
      void writeSaved(queryClient, queries.agentSkills.list.queryKey(), () => skills),
    [queries],
  );
  const refreshAgentSkills = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queries.agentSkills.list.queryKey() });
  }, [queries]);
  const [teachBusy, setTeachBusy] = useState(false);
  const messagingStatus = useQuery({
    ...queries.messaging.status.queryOptions(),
    enabled: Boolean(session.data?.user),
  }).data;
  const messagingSurfaceEnabled = messagingStatus?.enabled ?? false;
  const messagingProviders = messagingStatus?.providers ?? NO_PROVIDERS;
  const memoryConfigQuery = useQuery(queries.memory.providerConfig.queryOptions());
  // Undefined while it first loads; null when the space has none or it could not be read.
  const memoryProviderConfig: SpaceMemoryConfig | null | undefined =
    memoryConfigQuery.data !== undefined
      ? memoryConfigQuery.data
      : memoryConfigQuery.isError
        ? null
        : undefined;
  const call = useCallSession();
  /** Calls a bot, or opens voice settings first when no voice is connected. */
  const callBot = (bot: Bot) => {
    if (!bootstrapMe?.phoneCallsEnabled) return;
    if (!voiceStatus?.ready) {
      openSettings("voice");
      return;
    }
    startCall({
      botId: bot.id,
      botName: bot.name,
      botColor: bot.color,
      botAvatarSet: bot.avatarSet,
      transcribe: voiceStatus ? Boolean(voiceStatus.transcribe) : undefined,
    });
  };
  const voiceStatus: VoiceStatus | null =
    useQuery(queries.voice.status.queryOptions()).data ?? null;
  const { mobileSidebarOpen, setMobileSidebarOpen, swipeHandlers } = useMobileSidebar();
  const isMobileSidebar = useIsMobile();
  const miniSidebar = botsSidebarCollapsed && !isMobileSidebar;
  const dialogs = useShellDialogs();
  const [botMenu, setBotMenu] = useState<{ kind: "bot" | "group"; id: string } | null>(null);
  const closeBotMenu = useCallback(() => setBotMenu(null), []);
  const currentSpaceId = selectedSpaceId() ?? bootstrapMe?.spaceId ?? null;
  // null: settings follow the space the app is showing.
  const settingsSpaceId = overlay?.kind === "settings" ? overlay.spaceId : null;
  const settingsSpace =
    spaces.find((space) => space.id === (settingsSpaceId ?? currentSpaceId)) ?? null;
  // Never fall back to another space's settings when the edited space goes away.
  const settingsSpaceGone = initialBotsLoaded && settingsSpaceId !== null && !settingsSpace;
  useEffect(() => {
    if (settingsSpaceGone) setOverlay(null);
  }, [settingsSpaceGone]);

  const inGroup = Boolean(groupId);
  // Until the route names the chat reopened from cache, that chat stands in for it.
  const routeChat = botId || groupId ? undefined : startChat;
  const active =
    inGroup || routeChat?.groupId
      ? undefined
      : (bots.find((b) => b.id === (botId ?? routeChat?.botId)) ?? bots[0]);
  const userBubble = useMemo(
    () => (active ? chatUserBubbleColors(active.color, active.id) : undefined),
    [active?.color, active?.id],
  );
  const activeGroup = groups.find((group) => group.id === groupId);
  const activeBotId = useRef<string | undefined>(inGroup ? undefined : active?.id);
  activeBotId.current = inGroup ? undefined : active?.id;
  const activeGroupId = useRef<string | undefined>(groupId);
  activeGroupId.current = groupId;
  const computerState = useComputerState({ rpc, panel, activeId: active?.id, activeBotId });
  const { computer, computerOpen, setComputerOpen, booting, commitComputer } = computerState;
  useSpaceBootstrap({
    rpc,
    roster,
    thread,
    commitComputer,
    userId,
    shellSpaceId,
    seed,
    startChat,
    botId,
    groupId,
    chat: groupId ? { groupId } : active ? { botId: active.id } : undefined,
    navigate,
    redirectKeepingOverlay,
  });
  const { notifyBrowserForEvent, flushPendingBrowserNotifications } =
    useBrowserNotifications(botsRef);
  const { speakingMessageId, speakMessage } = useReadAloud({
    active,
    snapshot,
    callBotId: call?.botId,
    activeBotId,
  });
  const read = useChatRead({ rpc, active, groupId, activeGroup, setBots, setGroups });
  // Manor's live activity feed: the open bot's tool calls in the current run.
  const [activity, setActivity] = useState<
    Array<{ id: string; runId: string; name: string; detail: string }>
  >([]);
  const [showActivity, setShowActivity] = useState(
    () => window.localStorage.getItem("manor.showActivity") !== "0",
  );
  const toggleActivity = useCallback(() => {
    setShowActivity((prev) => {
      window.localStorage.setItem("manor.showActivity", prev ? "0" : "1");
      return !prev;
    });
  }, []);
  useEffect(() => setActivity([]), [active?.id]);
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
  const {
    refreshThread,
    refreshGroupThread,
    refreshThreadRef,
    refreshGroupThreadRef,
    refreshActiveThread,
    loadOlder,
    loadingOlder,
    terminalRunReceipts,
  } = useThreadSync({
    rpc,
    queries,
    thread,
    computerState,
    seed,
    active,
    inGroup,
    groupId,
    activeGroup,
    activeBotId,
    activeGroupId,
    botsRef,
    searchParamsRef,
    refreshBots,
    notifyBrowserForEvent,
    markBotReadIfVisible: read.markBotReadIfVisible,
    markGroupReadOnReply: read.markGroupReadOnReply,
    onBotEvent: recordActivity,
  });
  const {
    editorProps: routineEditorProps,
    deleteDialogProps: deleteRoutineDialogProps,
    editingRoutine,
    restoreRoutine,
    editRoutine,
    startRoutine,
    resetRoutineTarget,
    leaveRoutine,
    addSkillRoutine,
  } = useRoutineEditor({
    rpc,
    active,
    activeBotId,
    timezone: bootstrapMe?.timezone,
    setBots,
    refreshThread,
    setPanel,
    messageProviders: messagingProviders,
  });
  // Until this visit's read lands, a bot shows the routines and skills it had last time.
  const activeRoutines =
    inGroup || !active
      ? []
      : thread.routinesBotId === active.id
        ? thread.routines
        : (queryClient.getQueryData(
            queries.routines.list.queryKey({ input: { botId: active.id } }),
          ) ?? []);
  const activeTaughtSkills = !active
    ? []
    : thread.taughtSkillsBotId === active.id
      ? thread.taughtSkills
      : (queryClient.getQueryData(queries.skills.list.queryKey({ input: { botId: active.id } })) ??
        []);
  const recordingSkill = activeTaughtSkills.find((skill) => skill.status === "recording") ?? null;

  const sidebarSpaces = useMemo(
    () =>
      spaces.length > 0
        ? spaces.map((space) =>
            space.id === bootstrapMe?.spaceId ? { ...space, bots, groups, botSections } : space,
          )
        : bootstrapMe
          ? [
              {
                id: bootstrapMe.spaceId,
                name: "Personal",
                isDefault: true,
                organizationId: "",
                organizationName: "",
                hasContent: true,
                canRename: false,
                canDelete: false,
                bots,
                groups,
                botSections,
              },
            ]
          : [],
    [bootstrapMe, botSections, bots, groups, spaces],
  );
  const sidebarGroups = useMemo(
    () =>
      // Manor names the space on every header, even when the account has only one.
      sidebarGroupsForSpaces(
        sidebarSpaces,
        miniSidebar ? "" : search.query,
        { pinned: t`Pinned`, unassigned: t`Unassigned` },
        { alwaysNameSpaces: true },
      ),
    [sidebarSpaces, search.query, miniSidebar, t],
  );
  // The Dock badge ignores the roster search box: a filter must not hide unread chats.
  const unreadChatCount = useMemo(
    () => countUnreadChats(sidebarGroupsForSpaces(sidebarSpaces, "")),
    [sidebarSpaces],
  );
  useDesktopBadge(userId ? unreadChatCount : 0);

  // Navigation contains only the account's organization for this portal.
  const currentOrganizationName = useMemo(() => {
    const currentSpaceId = selectedSpaceId() ?? bootstrapMe?.spaceId;
    // An unreadable legacy organization name is hidden rather than printed raw.
    const name = spaces.find((space) => space.id === currentSpaceId)?.organizationName;
    return displayName(name, "") || null;
  }, [spaces, bootstrapMe?.spaceId]);
  const openSpaceChat = useOpenSpaceChat({
    bootstrapSpaceId: bootstrapMe?.spaceId,
    userId,
    navigate,
    navigationRevision,
    overlayRevision,
    closeMobileSidebar: () => setMobileSidebarOpen(false),
  });

  const activeSnapshot = inGroup
    ? snapshot?.groupId === groupId
      ? snapshot
      : null
    : snapshot?.botId === active?.id
      ? snapshot
      : null;
  const currentRuns = activeThreadRuns(activeSnapshot);
  const answerableAskIds = useMemo(() => answerableAskMessageIds(activeSnapshot), [activeSnapshot]);
  const dismissableAskIds = useMemo(
    () => dismissableAskMessageIds(activeSnapshot, userId),
    [activeSnapshot, userId],
  );
  const workingRuns = currentRuns.filter((run) => isRunWorking(run.status));
  const transcriptRunning = workingRuns.length > 0;
  const composerRunning = currentRuns.some((run) => isActive(run.status));
  const transcript = useMemo(
    () => foldPeerReplies(activeSnapshot?.messages ?? [], { includePeerReceipts: true }),
    [activeSnapshot?.messages],
  );
  const transcriptArtifactTarget = useMemo<ArtifactTarget>(
    () => (inGroup ? { groupId: groupId ?? "" } : { botId: active?.id ?? "" }),
    [active?.id, groupId, inGroup],
  );
  const transcriptMembers = activeSnapshot?.members ?? activeGroup?.members;
  const resolveTranscriptBot = useCallback(
    (botId: string) => {
      const bot = bots.find((candidate) => candidate.id === botId);
      if (bot) return bot;
      return transcriptMembers?.find((member) => member.botId === botId);
    },
    [bots, transcriptMembers],
  );
  const workingBots: GroupAvatarMember[] = workingRuns.map((run) => {
    const bot = resolveTranscriptBot(run.botId);
    return {
      botId: run.botId,
      color: bot?.color ?? FALLBACK_BOT_COLOR,
      avatarSet: bot?.avatarSet,
      name: bot?.name,
      status: run.status,
    };
  });
  const resolveTranscriptMemberName = useCallback(
    (botId: string | undefined) => memberName(transcriptMembers, botId),
    [transcriptMembers],
  );
  const { composerMentionTargets, footerLogos, setFooterLogos } = useComposerMentions({
    rpc,
    queries,
    bots,
    groups,
    inGroup,
    groupId,
    integrationsOpen: overlay?.kind === "integrations",
    initialBotsLoaded,
  });
  const shellReady =
    initialBotsLoaded &&
    (inGroup
      ? Boolean(activeGroup && activeSnapshot)
      : bots.length === 0 || Boolean(active && activeSnapshot));

  useLayoutEffect(() => {
    if (initialBotsLoaded) {
      markOnce("rk:renderer:bots-committed");
      markAfterPaint("rk:renderer:bots-painted");
    }
    if (active && snapshot?.botId === active.id) {
      markOnce("rk:renderer:thread-committed");
      markAfterPaint("rk:renderer:thread-painted");
    }
    if (shellReady) {
      markShellReady();
      markOnce("rk:renderer:shell-ready");
      markAfterPaint("rk:renderer:shell-painted");
    }
  }, [active, initialBotsLoaded, shellReady, snapshot?.botId]);

  const { scrollRequest, clearScrollRequest, jumpToReplyMessage } = useMessageJump({
    rpc,
    queries,
    thread,
    commitComputer,
    transcript,
    active,
    inGroup,
    groupId,
    activeBotId,
    activeGroupId,
    searchParams,
    setSearchParams,
    setPanel,
    setPanelState: rightPanel.setPanelState,
    editRoutine,
    resetRoutineTarget,
  });
  const computerControls = useComputerControls({
    rpc,
    state: computerState,
    panel,
    active,
    bots,
    botsRef,
    activeBotId,
    activeGroupId,
    runStatus: snapshot?.run?.status,
    sandboxProvider: bootstrapMe?.sandboxProvider,
    refreshThread,
    refreshGroupThread: (id) => refreshGroupThreadRef.current(id),
  });
  const { computerBot, openComputer } = computerControls;
  const composer = useComposerActions({
    rpc,
    activeId: active?.id,
    inGroup,
    groupId,
    activeBotId,
    activeGroupId,
    botsRef,
    bootstrapMe,
    activeSnapshot,
    navigate,
    refreshBots,
    refreshThreadRef,
    refreshGroupThreadRef,
    updateSnapshot: thread.updateSnapshot,
    terminalRunReceipts,
    computerRef: computerState.computerRef,
    commitComputer,
    clearReadBoundary: read.clearReadBoundary,
    flushPendingBrowserNotifications,
  });
  const { sending, sendError, stopRun } = composer;
  function openChatSettings(kind: "bot" | "group", id: string) {
    const destKey =
      userId && bootstrapMe?.spaceId
        ? rightPanelStorageKey(userId, bootstrapMe.spaceId, kind, id)
        : null;
    rightPanel.openPanelInChat(destKey, kind === "bot" ? "settings" : "group-settings", () =>
      navigate(kind === "bot" ? `/app/${id}` : `/app/g/${id}`),
    );
  }

  const replyTargetName = composer.replyTarget
    ? composer.replyTarget.role === "user"
      ? (channelMessageSender(composer.replyTarget.blocks) ?? t`You`)
      : (resolveTranscriptMemberName(composer.replyTarget.botId) ?? active?.name ?? t`Bot`)
    : undefined;
  useRightPanelRestore({
    rightPanel,
    userId,
    spaceId: bootstrapMe?.spaceId,
    inGroup,
    // The CRM, Workspace and docs places have no chat, so no bot's saved panel is restored there.
    panelTarget:
      crmOpen || docsOpen || workspaceOpen ? undefined : inGroup ? activeGroup?.id : active?.id,
    activeId: active?.id,
    routines: thread.routines,
    routinesBotId: thread.routinesBotId,
    searchParams,
    editingRoutineId: editingRoutine?.id,
    restoreRoutine,
    leaveRoutine,
  });
  const rosterDrop = useRosterDrop({
    rpc,
    bots,
    reorderRosterBot: roster.reorderRosterBot,
    refreshBots,
    refreshGroupThread: (id) => refreshGroupThreadRef.current(id),
    activeGroupId,
    setSendError: composer.setSendError,
  });

  // Keep unsaved drafts when a panel closes or the user switches bots, scoped to this signed-in shell.
  const fileControllers = useRef(new Map<string, WorkspaceFilesController>());
  const filesForBot = (id: string) => {
    const key = `${id}:${computer?.mode ?? "team"}`;
    let controller = fileControllers.current.get(key);
    if (!controller) {
      controller = new WorkspaceFilesController(id, (request) => rpc.computer.workspace(request));
      fileControllers.current.set(key, controller);
    }
    return controller;
  };
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if ([...fileControllers.current.values()].some((controller) => controller.dirty)) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);

  // Manor's app preview: a bot's share_preview opens it beside the chat, on the primary host.
  const [previewTarget, setPreviewTarget] = useState<{
    botId: string;
    messageId: string;
    port: number;
    path?: string;
    title?: string;
  } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const lastPreviewMessage = useRef<string | null>(null);
  const activePreview = active && previewTarget?.botId === active.id ? previewTarget : null;
  // Mint a fresh signed preview link while the pane is open; links expire after an hour.
  useEffect(() => {
    if (panel !== "preview" || !activePreview || computer?.state !== "running") {
      setPreviewUrl(null);
      return;
    }
    let cancelled = false;
    const mint = () => {
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
    };
    mint();
    const timer = setInterval(mint, 45 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [panel, activePreview, computer?.state]);
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
  const framedPreviewUrl = framablePreviewUrl(previewUrl, window.location.href);

  // Manor takes file drops on the whole chat pane. The composer looks at each drop first, so a
  // dropped agent folder or backup can offer Import.
  const composerDropRef = useRef<((drop: CapturedDrop) => boolean) | null>(null);
  const paneDropTaken = useRef(false);
  const fileDropZone = useFileDropZone<HTMLDivElement>({
    disabled: Boolean(recordingSkill) || (!active && !activeGroup),
    onFiles: (files) => {
      if (!paneDropTaken.current) void composer.onAttachmentPick(files);
    },
  });
  const paneDrop = {
    dragging: fileDropZone.dragging,
    handlers: {
      ...fileDropZone.handlers,
      onDrop: (event: DragEvent<HTMLDivElement>) => {
        const take = composerDropRef.current;
        paneDropTaken.current = Boolean(
          take && isFileDrag(event.dataTransfer) && take(captureDrop(event.dataTransfer)),
        );
        fileDropZone.handlers.onDrop(event);
        paneDropTaken.current = false;
      },
    },
  };

  const openBot = useCallback((id: string) => navigate(`/app/${id}`), [navigate]);
  // An import's setup checklist re-checks on each thread refresh, so refresh once setup closes.
  const importSetupOpen = useRef(false);
  useEffect(() => {
    if (!importSetupOpen.current || overlay || searchParams.has("routine")) return;
    importSetupOpen.current = false;
    void refreshActiveThread();
  }, [overlay, searchParams, refreshActiveThread]);
  const stopTeaching = useCallback(async () => {
    const id = activeBotId.current;
    if (!id || teachBusy) return;
    const recording = thread.taughtSkills.find(
      (skill) => skill.status === "recording" && thread.taughtSkillsBotId === id,
    );
    if (!recording) return;
    setTeachBusy(true);
    try {
      await rpc.skills.stop({ skillId: recording.id });
      await refreshThreadRef.current(id);
      setComputerOpen(false);
    } finally {
      setTeachBusy(false);
    }
  }, [teachBusy, thread.taughtSkills, thread.taughtSkillsBotId]);
  // Teach chrome needs skills applied before this resolves — refreshThread only
  // kicks skills.list off in the background, so Stop teaching would never mount
  // if that background call failed or lagged behind local recovery.
  const refreshActiveTeaching = useCallback(async () => {
    const id = activeBotId.current;
    if (!id) return;
    await refreshThreadRef.current(id);
    const skills = await fetchFresh(
      queryClient,
      queries.skills.list.queryOptions({ input: { botId: id } }),
    );
    if (activeBotId.current !== id) return;
    thread.setTaughtSkills(skills);
    thread.setTaughtSkillsBotId(id);
  }, []);

  function setBotsSidebarCollapsedPref(collapsed: boolean) {
    setBotsSidebarCollapsed(collapsed);
    writeBotsSidebarCollapsed(userId, collapsed);
  }

  function openSettings(section: SettingsSection = "general", spaceId: string | null = null) {
    setOverlay({ kind: "settings", section, spaceId });
  }

  // Space-scoped sections bind their own rpc client to this space, so another
  // space's settings open in place without switching the app or reloading.
  function openSpaceSettings(spaceId: string) {
    openSettings("space", spaceId);
  }

  function openImport(agent: AgentImportReader | null, fromDialog: boolean) {
    setDroppedAgent(agent);
    setImportFromDialog(fromDialog);
    setPanel("import-agent");
  }

  async function renameSpace(spaceId: string, name: string) {
    await commitSpaceRename({
      rename: async () => {
        await rpc.spaces.rename({ spaceId, name });
      },
      apply: () => {
        setSpaces((current) =>
          current.map((space) => (space.id === spaceId ? { ...space, name } : space)),
        );
      },
      refresh: () => refreshBots(),
    });
  }

  async function removeSpace(spaceId: string) {
    const result = await rpc.spaces.remove({ spaceId });
    if (!alive.current) return;
    setPanel(null);
    const effectiveSpaceId = selectedSpaceId() ?? bootstrapMe?.spaceId;
    if (effectiveSpaceId === spaceId) {
      // The auth boundary changed, so reload like a space switch.
      if (selectSpace(result.activeSpaceId)) {
        window.location.assign("/app");
        return;
      }
    }
    await refreshBots(true);
  }

  function openCreatedBot(bot: Bot) {
    roster.addCreatedBot(bot);
    navigate(`/app/${bot.id}`);
    setPanel(null);
  }

  async function createBot(input: CreateBotDialogInput) {
    const isFirstBot = botsRef.current.length === 0;
    const bot = await rpc.bots.create({ ...input, notifyOnFinish: true });
    openCreatedBot(bot);
    dialogs.setCreateBotOpen(false);
    await composer.startFocusPrompt(bot.id, isFirstBot);
    await refreshBots().catch(() => undefined);
  }

  const contextBot =
    botMenu?.kind === "bot" ? bots.find((bot) => bot.id === botMenu.id) : undefined;
  const contextGroup =
    botMenu?.kind === "group" ? groups.find((group) => group.id === botMenu.id) : undefined;
  const botMenuContent =
    contextBot || contextGroup ? (
      <ChatContextMenu
        rpc={rpc}
        bot={contextBot}
        group={contextGroup}
        sections={botSections}
        spaceId={bootstrapMe?.spaceId}
        onClose={closeBotMenu}
        refreshBots={refreshBots}
        read={read}
        dialogs={dialogs}
        openChatSettings={openChatSettings}
        navigate={navigate}
      />
    ) : null;
  const shell = (
    <BotsSidebarLayout
      userId={userId}
      collapsed={botsSidebarCollapsed}
      onCollapsedChange={setBotsSidebarCollapsedPref}
      onPreviewCollapsedChange={setBotsSidebarCollapsed}
      computerOpen={computerOpen}
      data-testid="shell-root"
      data-ready={shellReady}
      className="relative flex h-full min-h-0 min-w-0 overflow-hidden bg-[var(--rk-page)] text-[#DFDFE2] [&[data-resizing-sidebar]_*[data-slot=sidebar-gap]]:transition-none [&[data-resizing-sidebar]_*[data-slot=sidebar-container]]:transition-none"
      {...swipeHandlers}
    >
      <ComputerUpdateProgress
        onCompleted={() => {
          if (active) void refreshThread(active.id);
        }}
      />
      {bootstrapMe !== undefined ? (
        <HostComputerPrompt initialMe={bootstrapMe ?? undefined} onMeUpdated={setBootstrapMe} />
      ) : null}
      <ShellSidebar
        isMobile={isMobileSidebar}
        mobileOpen={mobileSidebarOpen}
        setMobileOpen={setMobileSidebarOpen}
        density={botsSidebarDensity}
        collapsed={botsSidebarCollapsed}
        mini={miniSidebar}
        setCollapsedPref={setBotsSidebarCollapsedPref}
        createMenuOpen={createMenuOpen}
        setCreateMenuOpen={setCreateMenuOpen}
        search={search}
        bots={bots}
        setPanel={setPanel}
        navigate={navigate}
        setNewSpaceOpen={dialogs.setNewSpaceOpen}
        setCreateBotOpen={dialogs.setCreateBotOpen}
        roster={
          <>
            {currentOrganizationName && !miniSidebar ? (
              <p className="truncate px-2.5 pt-3 pb-0.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[#6E6975]">
                {currentOrganizationName}
              </p>
            ) : null}
            <SidebarRoster
              mini={miniSidebar}
              sidebarGroups={sidebarGroups}
              collapsedSidebarSections={collapsedSidebarSections}
              bootstrapMe={bootstrapMe}
              botSections={botSections}
              spaces={spaces}
              rosterDropKey={rosterDrop.rosterDropKey}
              setRosterDropKey={rosterDrop.setRosterDropKey}
              rosterDropAction={rosterDrop.rosterDropAction}
              applyRosterDrop={rosterDrop.applyRosterDrop}
              openSpaceChat={openSpaceChat}
              spaceMenuAnchor={dialogs.spaceMenuAnchor}
              setSpaceMenu={dialogs.setSpaceMenu}
              setRenameSectionTarget={dialogs.setRenameSectionTarget}
              setDeleteSectionTarget={dialogs.setDeleteSectionTarget}
              toggleSidebarSection={toggleSidebarSection}
              inGroup={inGroup}
              active={active}
              activeGroup={activeGroup}
              botsSidebarDensity={botsSidebarDensity}
              dismissedRunErrorIds={composer.dismissedRunErrorIds}
              displayedRunError={composer.displayedRunError}
              draggedBotId={rosterDrop.draggedBotId}
              setDraggedBotId={rosterDrop.setDraggedBotId}
              botMenu={botMenu}
              setBotMenu={setBotMenu}
              reorderRosterBot={roster.reorderRosterBot}
              activeSnapshot={activeSnapshot}
              botMenuContent={botMenuContent}
            />
          </>
        }
        archived={
          <ArchivedChats
            archivedBots={archivedBots}
            archivedGroups={archivedGroups}
            showSpaceSearch={search.showSpaceSearch}
            rpc={rpc}
            refreshBots={refreshBots}
            setDeleteTarget={dialogs.setDeleteTarget}
            setDeleteGroupTarget={dialogs.setDeleteGroupTarget}
          />
        }
        footerLogos={footerLogos}
        user={session.data?.user}
        ticketBoardEnabled={Boolean(bootstrapMe?.ticketBoardEnabled)}
        navLinks={desktopBridge() ? [] : (bootstrapMe?.navLinks ?? [])}
        openSettings={openSettings}
        openIntegrations={() => setOverlay({ kind: "integrations" })}
        openSkills={() => setOverlay({ kind: "skills" })}
        places={
          // Manor's places and Integrations sit above upstream's account footer.
          <div className={miniSidebar ? "flex flex-col items-center" : "contents"}>
            {workspace ? (
              <ManorNavRow
                mini={miniSidebar}
                label={t`Workspace`}
                icon={<Waypoints size={15} strokeWidth={1.7} />}
                active={workspaceOpen}
                onClick={() => {
                  setMobileSidebarOpen(false);
                  navigate("/app/workspace");
                }}
              />
            ) : null}
            <ManorNavRow
              mini={miniSidebar}
              label="CRM"
              icon={<CrmIcon />}
              active={crmOpen}
              onClick={() => {
                setMobileSidebarOpen(false);
                navigate("/app/crm");
              }}
            />
            <ManorNavRow
              mini={miniSidebar}
              label={t`Integrations`}
              icon={<LayoutGrid size={15} strokeWidth={1.7} />}
              onClick={() => setOverlay({ kind: "integrations" })}
            />
            <ManorNavRow
              mini={miniSidebar}
              label={t`Documentation`}
              icon={<BookOpen size={15} strokeWidth={1.7} />}
              active={docsOpen}
              onClick={() => {
                setMobileSidebarOpen(false);
                navigate("/app/docs");
              }}
            />
          </div>
        }
      />

      {/* Keep the composer's z-index inside the chat so phone overlays like the side panel cover it. */}
      <main
        data-space-switch="main"
        aria-hidden={mobileSidebarOpen || undefined}
        inert={mobileSidebarOpen}
        className="isolate flex min-w-0 flex-1 flex-col bg-background"
      >
        {/* Inside main so the composer and its menus stay above it. */}
        {!mobileSidebarOpen ? (
          <div
            data-testid="mobile-sidebar-swipe-edge"
            aria-hidden="true"
            className="absolute bottom-20 start-0 top-16 z-20 w-8 touch-none md:hidden"
          />
        ) : null}
        {workspaceOpen ? (
          <WorkspaceView
            organizationName={currentOrganizationName}
            onOpenBot={(bot, text) => {
              setBots((current) =>
                current.some((candidate) => candidate.id === bot.id) ? current : [...current, bot],
              );
              navigate(`/app/${bot.id}`, { state: { composerPrefill: { botId: bot.id, text } } });
            }}
          />
        ) : crmOpen ? (
          <CrmView />
        ) : docsOpen ? (
          <DocsView />
        ) : (
          <div
            data-testid="chat-pane"
            data-dragging={paneDrop.dragging ? "files" : undefined}
            {...paneDrop.handlers}
            className="relative flex min-h-0 flex-1 flex-col"
          >
            {paneDrop.dragging ? (
              <FileDropOverlay
                name={
                  inGroup
                    ? (activeGroup?.name ?? activeSnapshot?.groupName ?? t`this group`)
                    : (active?.name ?? t`this bot`)
                }
              />
            ) : null}
            <CallReturnBar />
            {/* The header floats so the transcript scrolls under its buttons. */}
            <div className="relative flex min-h-0 flex-1 flex-col">
              {/* Only the pills take input; the gaps pass clicks and scrolling to the transcript. */}
              <div aria-hidden="true" className="app-drag absolute inset-x-0 top-0 z-10 h-3" />
              <ChatHeader
                inGroup={inGroup}
                active={active}
                activeGroup={activeGroup}
                activeSnapshot={activeSnapshot}
                phoneCallsEnabled={Boolean(bootstrapMe?.phoneCallsEnabled)}
                inCall={Boolean(active) && call?.botId === active?.id}
                computerPanelOpen={panel === "computer"}
                onOpenNavigation={() => setMobileSidebarOpen(true)}
                onOpenChatSettings={() => setPanel(inGroup ? "group-settings" : "settings")}
                onCall={(bot) => {
                  if (call?.botId === bot.id) {
                    setCallMinimized(false);
                    return;
                  }
                  callBot(bot);
                }}
                onToggleComputer={(bot) => {
                  const next = panel === "computer" ? null : "computer";
                  setPanel(next);
                  if (next === "computer") {
                    // Refresh run/computer so Take control isn't stuck on a stale busyBotName.
                    void refreshThread(bot.id).catch(() => undefined);
                  }
                }}
                leadingActions={
                  <IconTooltip label={showActivity ? t`Hide live activity` : t`Show live activity`}>
                    <Button
                      variant="floating"
                      size="icon-lg"
                      aria-label={showActivity ? t`Hide live activity` : t`Show live activity`}
                      aria-pressed={showActivity}
                      onClick={toggleActivity}
                      className="app-no-drag"
                    >
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke={showActivity ? accentColor : "currentColor"}
                        strokeWidth="1.6"
                        aria-hidden="true"
                      >
                        <path d="M2 12h4l3-8 4 16 3-8h6" />
                      </svg>
                    </Button>
                  </IconTooltip>
                }
                trailingActions={
                  <>
                    {!inGroup && active ? (
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
                    {!inGroup ? (
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
                    ) : null}
                  </>
                }
              />
              {!active && !activeGroup && initialBotsLoaded ? (
                <div className="grid flex-1 place-items-center">
                  <Button onClick={() => dialogs.setCreateBotOpen(true)}>
                    <Plus size={16} aria-hidden="true" />
                    <Trans>New bot</Trans>
                  </Button>
                </div>
              ) : (
                <Transcript
                  key={activeSnapshot?.threadId}
                  scrollRef={thread.messageScroll}
                  scrollRequest={scrollRequest}
                  onScrollRequestHandled={clearScrollRequest}
                  artifactTarget={transcriptArtifactTarget}
                  markedUnreadMessageId={read.markedUnreadMessageId}
                  transcript={transcript}
                  olderCursor={activeSnapshot?.olderCursor ?? null}
                  unreadAfterSeq={read.unreadAfterSeq}
                  loadingOlder={loadingOlder}
                  answerableAskIds={answerableAskIds}
                  dismissableAskIds={dismissableAskIds}
                  running={transcriptRunning}
                  liveRun={
                    activeSnapshot?.run && isActive(activeSnapshot.run.status)
                      ? {
                          startedAt: activeSnapshot.run.startedAt,
                          name: active?.name ?? activeGroup?.name ?? activeSnapshot.groupName ?? "",
                        }
                      : undefined
                  }
                  workingBots={workingBots}
                  userBubble={userBubble}
                  onCallBack={
                    bootstrapMe?.phoneCallsEnabled && !inGroup && active
                      ? () => callBot(active)
                      : undefined
                  }
                  activityFeed={
                    showActivity && activity.some((item) => item.runId === snapshot?.run?.id) ? (
                      <div className="w-full max-w-[560px] rounded-[16px] border border-[#1F1B29] bg-[#0C0B10] px-4 py-3">
                        <div className="rk-label mb-2 text-[10.5px] text-[#6E6975]">
                          <Trans>Activity</Trans>
                        </div>
                        <div className="flex flex-col gap-[7px]">
                          {activity
                            .filter((item) => item.runId === snapshot?.run?.id)
                            .map((item, index, list) => (
                              <div
                                key={item.id}
                                className="flex items-baseline gap-2.5 font-mono text-[12.5px]"
                                style={
                                  index === list.length - 1
                                    ? { animation: "rkPulse 1.2s ease-in-out infinite" }
                                    : undefined
                                }
                              >
                                <span className="shrink-0 text-[var(--rk-accent)]">
                                  {item.name}
                                </span>
                                {item.detail ? (
                                  <span className="truncate text-[#6E6975]">{item.detail}</span>
                                ) : null}
                              </div>
                            ))}
                        </div>
                      </div>
                    ) : null
                  }
                  onLoadOlder={loadOlder}
                  onOpenBot={openBot}
                  onAnswer={composer.answerMessage}
                  onReply={(message) => {
                    composer.setReplyTarget(message);
                    composer.setReplyQuote(null);
                  }}
                  onMarkUnread={(message: ThreadMessage) => {
                    // The next open of this chat starts the New divider at this message.
                    if (groupId) read.markGroupUnreadFrom(groupId, message.id);
                    else if (active)
                      void read.markBotUnread(active.id, message.id).catch(() => undefined);
                  }}
                  onQuote={(message, quote) => {
                    composer.setReplyTarget(message);
                    composer.setReplyQuote(quote);
                  }}
                  onReact={composer.reactToMessage}
                  onJumpToMessage={jumpToReplyMessage}
                  onOpenPeerMessages={(peer) => {
                    setPeerConversation(peer);
                  }}
                  memberName={resolveTranscriptMemberName}
                  peerBot={resolveTranscriptBot}
                  onRefresh={refreshActiveThread}
                  onBotChanged={refreshBots}
                  onAddRoutine={addSkillRoutine}
                  onOpenPreview={openPreview}
                  voiceReady={Boolean(voiceStatus?.ready)}
                  speakingMessageId={speakingMessageId}
                  onSpeak={speakMessage}
                  onOpenComputer={computerControls.onOpenComputer}
                  onOpenImport={() => openImport(null, false)}
                  onOpenImportSetup={(target) => {
                    importSetupOpen.current = true;
                    if (target.kind === "models") openSettings("models");
                    else if (target.kind === "mcp")
                      setOverlay({ kind: "mcp", serverId: target.serverId });
                    else {
                      const next = new URLSearchParams(searchParams);
                      next.set("routine", target.routineId);
                      setSearchParams(next);
                    }
                  }}
                />
              )}
            </div>
            {active || activeGroup ? (
              // Let messages continue behind the composer's rounded top corners.
              <div className="pointer-events-none relative z-30 -mt-7">
                {recordingSkill ? (
                  <div className="pointer-events-auto bg-background px-6 pb-2 text-center text-[13px] text-destructive">
                    <Trans>Teaching in progress. Stop teaching before sending a new message.</Trans>
                  </div>
                ) : null}
                <Composer
                  key={inGroup ? `group:${groupId}` : `bot:${active?.id}`}
                  draftKey={inGroup ? `group:${groupId}` : `bot:${active?.id}`}
                  enterToSend={enterToSend}
                  prefill={
                    inGroup
                      ? undefined
                      : composerPrefillFromState(location.state, location.key, botId, active?.id)
                  }
                  onPrefillConsumed={() =>
                    navigate(`${location.pathname}${location.search}`, {
                      replace: true,
                      state: null,
                    })
                  }
                  paneDropRef={composerDropRef}
                  onImportAgent={(agent) => openImport(agent, false)}
                  activeName={
                    inGroup ? (activeGroup?.name ?? activeSnapshot?.groupName) : active?.name
                  }
                  running={composerRunning}
                  disabled={Boolean(recordingSkill)}
                  pendingAttachments={composer.activePendingAttachments}
                  attachmentNotice={composer.attachmentNotice}
                  sendError={sendError}
                  imageConfirmation={composer.imageConfirmation}
                  onDraftEdited={composer.clearImageConfirmation}
                  onOpenModels={() => {
                    // A group's failed run belongs to one member; change that bot's model.
                    const failedBotId =
                      inGroup && composer.displayedRunError ? activeSnapshot?.run?.botId : null;
                    if (active && !inGroup) {
                      setPanel("settings");
                      setModelFocusRequest(Date.now());
                    } else if (failedBotId) {
                      openChatSettings("bot", failedBotId);
                      setModelFocusRequest(Date.now());
                    } else openSettings("models");
                  }}
                  onOpenConnections={() => openSettings("models")}
                  runError={composer.displayedRunError}
                  runErrorId={composer.displayedRunErrorId}
                  onRunErrorPresented={composer.handleRunErrorPresented}
                  onDismissError={composer.dismissComposerError}
                  onOpenRunLogs={!inGroup && active ? () => setPanel("logs") : undefined}
                  sending={sending}
                  fileInputRef={composer.fileInputRef}
                  onAttachmentPick={composer.onAttachmentPick}
                  onRemoveAttachment={composer.removeAttachment}
                  onSend={composer.sendMessage}
                  onStop={stopRun}
                  phoneCallsEnabled={bootstrapMe?.phoneCallsEnabled === true}
                  dictationTranscribe={voiceStatus ? Boolean(voiceStatus.transcribe) : undefined}
                  artifactTarget={transcriptArtifactTarget}
                  replyTarget={composer.replyTarget}
                  replyQuote={composer.replyQuote}
                  replyTargetName={replyTargetName}
                  onClearReply={composer.clearReply}
                  mentionTargets={composerMentionTargets}
                  agentSkills={agentSkills}
                  onSlashOpen={refreshAgentSkills}
                  onSlashAction={(action) => {
                    if (action === "chat-settings") {
                      setPanel(inGroup ? "group-settings" : "settings");
                      return;
                    }
                    if (action === "settings-general") {
                      openSettings("general");
                      return;
                    }
                    if (action === "settings-usage") {
                      openSettings("usage");
                    }
                  }}
                />
              </div>
            ) : null}
          </div>
        )}
      </main>

      <CallCard onSettings={() => openSettings("voice")} />
      <IncomingCall
        bots={bootstrapMe?.phoneCallsEnabled ? bots : []}
        transcribe={voiceStatus ? Boolean(voiceStatus.transcribe) : undefined}
        onAnswered={(botId) => navigate(`/app/${botId}`)}
      />

      <ShellSidePanel
        rpc={rpc}
        panel={panel}
        setPanel={setPanel}
        active={active}
        activeGroup={activeGroup}
        bots={bots}
        groups={groups}
        setBots={setBots}
        setGroups={setGroups}
        navigate={navigate}
        refreshBots={refreshBots}
        refreshThread={refreshThread}
        refreshGroupThread={refreshGroupThread}
        refreshActiveThread={refreshActiveThread}
        computer={computer}
        computerOpen={computerOpen}
        booting={booting}
        computerPanel={
          active ? (
            <ComputerPanel
              bot={active}
              computer={computer}
              computerOpen={computerOpen}
              embeddedScreenUrl={computerControls.embeddedScreenUrl}
              screenFrameKey={computerState.screenFrameKey}
              screenFrameRef={computerState.setScreenFrame}
              computerScreenError={computerControls.computerScreenError}
              computerBooting={computerControls.computerBooting}
              booting={booting}
              showingRecoveryHint={computerControls.showingRecoveryHint}
              showComputerRecoveryHint={computerControls.showComputerRecoveryHint}
              sandboxProvider={bootstrapMe?.sandboxProvider}
              onRecovered={(sandboxProvider) => {
                setBootstrapMe((prev) => (prev ? { ...prev, sandboxProvider } : prev));
                computerControls.holdComputerRecovery();
              }}
              onRecoveryDismissed={computerControls.releaseComputerRecovery}
              onOpenComputerSettings={() => openSettings("computer")}
              onOpen={() => void openComputer()}
              routines={activeRoutines}
              runningRoutineId={
                snapshot?.run && isActive(snapshot.run.status)
                  ? (snapshot.run.routineId ?? undefined)
                  : undefined
              }
              onCreateRoutine={() => startRoutine()}
              onEditRoutine={startRoutine}
              onStopRun={() => void stopRun()}
            />
          ) : null
        }
        routineEditorProps={routineEditorProps}
        openBot={openBot}
        openCreatedBot={openCreatedBot}
        droppedAgent={droppedAgent}
        setDroppedAgent={setDroppedAgent}
        importFromDialog={importFromDialog}
        setCreateBotOpen={dialogs.setCreateBotOpen}
        modelFocusRequest={modelFocusRequest}
        openSettings={openSettings}
        memoryProviderConfigured={memoryProviderConfig != null}
        setAgentSkills={setAgentSkills}
        onClearBot={(bot) => dialogs.setClearTarget({ kind: "bot", chat: bot })}
        localComputer={bootstrapMe?.localComputer}
        manorTitle={
          // Manor titles its own panels and the computer; upstream's only title is a group's.
          panel === "preview" ||
          panel === "files" ||
          panel === "logs" ||
          (active && panel === "computer") ? (
            <span className="text-[13.5px] text-muted-foreground">
              {panel === "preview" ? (
                <Trans>Preview</Trans>
              ) : panel === "files" ? (
                <Trans>Files</Trans>
              ) : panel === "logs" ? (
                <Trans>Run logs</Trans>
              ) : active ? (
                <span className="flex gap-1.5">
                  <Trans>Computer</Trans>
                  <span>{computer?.state ?? active.status}</span>
                </span>
              ) : null}
            </span>
          ) : null
        }
        manorHeaderActions={
          active ? (
            <>
              {panel === "computer" ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t`Expand computer`}
                  onClick={() => void openComputer()}
                  className="text-muted-foreground"
                >
                  <Maximize2 size={16} strokeWidth={1.7} />
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={panel === "logs" ? t`Show computer` : t`Run logs`}
                onClick={() => setPanel(panel === "logs" ? "computer" : "logs")}
                className={panel === "logs" ? "text-foreground" : "text-muted-foreground"}
              >
                <ListFilter size={16} strokeWidth={1.7} />
              </Button>
              {activePreview ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={panel === "preview" ? t`Show computer` : t`Show preview`}
                  onClick={() => setPanel(panel === "preview" ? "computer" : "preview")}
                  className={panel === "preview" ? "text-foreground" : "text-muted-foreground"}
                >
                  <Globe size={16} strokeWidth={1.7} />
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={panel === "files" ? t`Show computer` : t`Show files`}
                onClick={() => setPanel(panel === "files" ? "computer" : "files")}
                className={panel === "files" ? "text-foreground" : "text-muted-foreground"}
              >
                <FolderTree size={16} strokeWidth={1.7} />
              </Button>
            </>
          ) : null
        }
        manorContent={
          active ? (
            <>
              {panel === "logs" ? <RunLogsPanel key={active.id} botId={active.id} /> : null}
              {panel === "files" ? (
                <FilesPanel
                  key={`${active.id}:${computer?.mode ?? "team"}`}
                  controller={filesForBot(active.id)}
                  team={computer?.mode === "team"}
                  computerState={computer?.state}
                  running={transcriptRunning}
                  onAttach={async (file) => {
                    composer.onAttachmentPick([file], active.id);
                  }}
                  onWake={() => {
                    void rpc.computer
                      .boot({ botId: active.id })
                      .then(() => refreshThread(active.id))
                      .catch(() => undefined);
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
            </>
          ) : null
        }
      />

      <Suspense fallback={null}>
        <ShellDialogs
          dialogs={dialogs}
          rpc={rpc}
          spaces={spaces}
          bots={bots}
          activeId={active?.id}
          activeGroupId={activeGroup?.id}
          alive={alive}
          navigate={navigate}
          setPanel={setPanel}
          refreshBots={refreshBots}
          removeSpace={removeSpace}
          openSpaceSettings={openSpaceSettings}
          closeMobileSidebar={() => setMobileSidebarOpen(false)}
          createBot={createBot}
          onImportFromCreate={() => {
            dialogs.setCreateBotOpen(false);
            openImport(null, true);
          }}
          clearOpenThread={() => {
            thread.resetHistory();
            thread.updateSnapshot((current) =>
              current ? { ...current, messages: [], olderCursor: null, run: null } : current,
            );
          }}
          deleteRoutineDialogProps={deleteRoutineDialogProps}
          localComputer={bootstrapMe?.localComputer}
        />
        <AppOverlays
          overlay={overlay}
          setOverlay={setOverlay}
          activeBotId={activeBotId.current}
          stdioEnabled={bootstrapMe?.mcpStdioEnabled === true}
          onConnectedAppsChange={setFooterLogos}
          space={spaces.find((space) => space.id === bootstrapMe?.spaceId)}
        />
      </Suspense>

      <Suspense fallback={null}>
        <SettingsOverlays
          rpc={rpc}
          queries={queries}
          overlay={overlay}
          setOverlay={setOverlay}
          settingsSpace={settingsSpace}
          showSettings={settingsSpaceId === null || Boolean(settingsSpace)}
          spaces={spaces}
          renameSpace={renameSpace}
          removeSpace={removeSpace}
          refreshSpaces={() => refreshBots()}
          alive={alive}
          user={session.data?.user}
          refetchSession={() => session.refetch({ query: { disableCookieCache: true } })}
          bootstrapMe={bootstrapMe}
          setBootstrapMe={setBootstrapMe}
          messagingEnabled={messagingSurfaceEnabled}
          memoryConfig={memoryProviderConfig}
          peerConversation={peerConversation}
          setPeerConversation={setPeerConversation}
          active={active}
          peerBot={resolveTranscriptBot}
        />
      </Suspense>

      {computerOpen && computerBot ? (
        <ComputerOverlay
          bot={computerBot}
          computer={computer}
          computerViewport={computerState.computerViewport}
          recordingSkill={recordingSkill}
          teachBusy={teachBusy}
          hasControl={computerControls.hasControl}
          composerRunning={composerRunning}
          sending={sending}
          booting={booting}
          runStatus={snapshot?.run?.status}
          sendError={sendError}
          embeddedScreenUrl={computerControls.embeddedScreenUrl}
          screenFrameKey={computerState.screenFrameKey}
          screenFrameRef={computerState.setScreenFrame}
          computerScreenError={computerControls.computerScreenError}
          computerBooting={computerControls.computerBooting}
          onStopTeaching={stopTeaching}
          onStopRun={() => void stopRun()}
          onRelease={computerControls.releaseComputer}
          onTakeControl={() => void openComputer(computerBot.id, true)}
          onStart={() => void openComputer(computerBot.id)}
          onRefreshTeaching={refreshActiveTeaching}
          onRefreshComputer={async () => {
            await computerControls.refreshComputerFor(computerBot.id);
          }}
          onClose={() => setComputerOpen(false)}
        />
      ) : null}
    </BotsSidebarLayout>
  );

  // Empty chrome until the first bot list lands would flash "Select a bot" before the chat.
  return initialBotsLoaded || initialLoadFailed ? shell : <PageLoading />;
}

function FileDropOverlay({ name }: { name: string }) {
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
          {t`Images, PDFs and text files, up to ${ATTACHMENT_MAX_COUNT}`}
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
