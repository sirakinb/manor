import { useLingui } from "@lingui/react/macro";
import type { AgentSkillCatalogEntry, ThreadMessage, ToolRoutingMode } from "@rakazo/contracts";
import { ATTACHMENT_ALLOWED_MIME_TYPES, TOOL_ROUTING_MODES } from "@rakazo/contracts";
import type { ComposerMention, SlashActionId } from "@rakazo/core";
import {
  clampMentionHighlightIndex,
  mentionChipKey,
  replyAttachment,
  resolveMentionPickerKey,
  SLASH_ACTIONS,
  serializeComposerPrompt,
  truncateSlashDescription,
} from "@rakazo/core";
import { Button } from "@rakazo/ui-web";
import {
  ArrowUp,
  Blend,
  Box,
  Cpu,
  Paperclip,
  Plus,
  Puzzle,
  Settings,
  Square,
  X,
} from "lucide-react";
import type { ClipboardEvent, RefObject } from "react";
import { memo, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  HoldToTalkControls,
  HoldToTalkStrip,
  useHoldToTalk,
} from "../../components/composer/HoldToTalk";
import type { ArtifactTarget } from "../../lib/artifact-open";
import { useCallSession } from "../../lib/call-session";
import { newClientId } from "../../lib/client-id";
import {
  beginComposerDraftSubmission,
  readComposerDraft,
  settleComposerDraftSubmission,
  subscribeComposerDraftAccepted,
  writeComposerDraft,
} from "../../lib/composer-draft";
import type { ComposerPrefill } from "../../lib/composer-prefill";
import { isFilePaste } from "../../lib/pending-attachments";
import { ComposerReplyPreview } from "./chat-context";
import type { PendingAttachment } from "./chat-shared";
import { previewMessageText } from "./chat-shared";
import { ComposerError } from "./composer-error";
import { MentionChipIcon, MentionOptionIcon, slashActionLabel } from "./composer-mentions";
import { useComposerLayout } from "./use-composer-layout";

const ATTACHMENT_ACCEPT = [...ATTACHMENT_ALLOWED_MIME_TYPES, ".zip"].join(",");
export const Composer = memo(function Composer({
  prefill,
  onPrefillConsumed,
  artifactTarget,
  activeName,
  running,
  disabled,
  pendingAttachments,
  attachmentNotice,
  sendError,
  onOpenModels,
  runError,
  runErrorId,
  onRunErrorPresented,
  onDismissError,
  onOpenRunLogs,
  sending,
  fileInputRef,
  onAttachmentPick,
  onRemoveAttachment,
  onSend,
  onStop,
  phoneCallsEnabled,
  dictationTranscribe,
  replyTarget,
  replyQuote,
  replyTargetName,
  onClearReply,
  mentionTargets,
  agentSkills,
  onSlashOpen,
  onSlashAction,
  draftKey,
  enterToSend,
}: {
  prefill?: ComposerPrefill;
  onPrefillConsumed?: () => void;
  activeName?: string;
  running: boolean;
  disabled?: boolean;
  pendingAttachments: PendingAttachment[];
  attachmentNotice: string | null;
  sendError: string | null;
  onOpenModels: () => void;
  runError: string | null;
  runErrorId: string | null;
  onRunErrorPresented: (runId: string) => void;
  onDismissError: () => void;
  onOpenRunLogs?: (() => void) | undefined;
  sending: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onAttachmentPick: (files: FileList | null) => boolean;
  onRemoveAttachment: (attachment: PendingAttachment) => void;
  onSend: (
    text: string,
    mentions: ComposerMention[],
    clientNonce: string,
    toolRoutingMode?: ToolRoutingMode,
  ) => Promise<boolean>;
  onStop: () => Promise<void>;
  phoneCallsEnabled?: boolean;
  /** Hold-to-talk falls back to the voice provider's transcription; undefined while unknown. */
  dictationTranscribe?: boolean;
  artifactTarget: ArtifactTarget;
  replyTarget?: ThreadMessage | null;
  replyQuote?: string | null;
  replyTargetName?: string;
  onClearReply?: () => void;
  mentionTargets?: ComposerMention[];
  agentSkills?: AgentSkillCatalogEntry[];
  onSlashOpen?: () => void;
  onSlashAction?: (action: SlashActionId) => void;
  draftKey: string;
  enterToSend: boolean;
}) {
  const { t } = useLingui();
  const [draft, setDraft] = useState(() => readComposerDraft(draftKey));
  const [mentionQuery, setMentionQuery] = useState<string | null>(() => {
    const mentionMatch = /(?:^|\s)@([\w-]*)$/.exec(draft);
    return mentionMatch ? (mentionMatch[1] ?? "") : null;
  });
  const [mentionHighlightKey, setMentionHighlightKey] = useState<string | null>(null);
  const [slashQuery, setSlashQuery] = useState<string | null>(() => {
    const slashMatch = /^\/([^\n]*)$/.exec(draft);
    return slashMatch ? (slashMatch[1] ?? "") : null;
  });
  const onCall = useCallSession() !== null;
  const talk = useHoldToTalk({
    transcribe: dictationTranscribe,
    disabled: disabled || onCall || !phoneCallsEnabled,
    onText: (text) => {
      // A refused send keeps the words: they land in the field to edit or retry.
      void onSend(text, [], newClientId())
        .then((accepted) => {
          if (accepted === false) setDraft((current) => (current ? `${current} ${text}` : text));
        })
        .catch(() => setDraft((current) => (current ? `${current} ${text}` : text)));
    },
  });
  const [selectedSkill, setSelectedSkill] = useState<AgentSkillCatalogEntry | null>(null);
  const [selectedMentions, setSelectedMentions] = useState<ComposerMention[]>([]);
  const editRevision = useRef(0);
  useEffect(
    () =>
      subscribeComposerDraftAccepted(draftKey, (text) => {
        setDraft((current) => (current === text ? "" : current));
        setMentionQuery(null);
        setSlashQuery(null);
      }),
    [draftKey],
  );
  const retryNonce = useRef<string | null>(null);
  const replyId = replyTarget?.id ?? null;
  const quote = replyTarget ? (replyQuote ?? null) : null;
  const previousReply = useRef({ id: replyId, quote });
  useEffect(() => {
    if (previousReply.current.id !== replyId || previousReply.current.quote !== quote) {
      editRevision.current += 1;
      retryNonce.current = null;
      previousReply.current = { id: replyId, quote };
    }
  }, [replyId, quote]);
  const {
    textareaRef,
    attachButtonRef,
    composerActionsRef,
    composerBarRef,
    composerFieldRef,
    expanded,
  } = useComposerLayout(draft, selectedSkill !== null || selectedMentions.length > 0);
  const consumedPrefill = useRef<string | null>(null);
  useEffect(() => {
    if (!prefill || consumedPrefill.current === prefill.key) return;
    consumedPrefill.current = prefill.key;
    markEdited();
    setDraft((current) => (current ? `${current}\n\n${prefill.text}` : prefill.text));
    textareaRef.current?.focus();
    onPrefillConsumed?.();
  }, [prefill, onPrefillConsumed]);
  // Files dropped on the chat pane or attached from the files panel are added by the
  // parent, so a change in the list counts as an edit here too.
  const attachmentKey = pendingAttachments.map((attachment) => attachment.id).join("\n");
  const previousAttachmentKey = useRef(attachmentKey);
  useEffect(() => {
    if (previousAttachmentKey.current === attachmentKey) return;
    previousAttachmentKey.current = attachmentKey;
    markEdited();
  }, [attachmentKey]);
  const [replyAnnouncement, setReplyAnnouncement] = useState("");
  // What the live region currently holds — a send disarming the reply clears
  // "reply" text, while an explicit cancel must keep "Reply cancelled".
  const replyAnnouncementKind = useRef<"reply" | "cancelled" | null>(null);
  const prevReplyTarget = useRef<ThreadMessage | null>(null);
  const mentionListboxId = useId();
  const [toolRoutingMode, setToolRoutingMode] = useState<ToolRoutingMode>("auto");
  const [routingPickerOpen, setRoutingPickerOpen] = useState(false);
  const routingPickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!routingPickerOpen) return;
    const closeIfOutside = (event: MouseEvent) => {
      if (!routingPickerRef.current?.contains(event.target as Node)) setRoutingPickerOpen(false);
    };
    document.addEventListener("mousedown", closeIfOutside);
    return () => document.removeEventListener("mousedown", closeIfOutside);
  }, [routingPickerOpen]);
  const toolRoutingLabel = (mode: ToolRoutingMode) =>
    mode === "vm" ? t`Computer only` : mode === "plugins" ? t`Plugins only` : t`Auto`;
  const toolRoutingDescription = (mode: ToolRoutingMode) =>
    mode === "vm"
      ? t`Only use the computer and sandbox, never connected plugins`
      : mode === "plugins"
        ? t`Only use connected plugins, never the computer`
        : t`Uses whichever fits the task`;
  const canSend =
    draft.trim().length > 0 ||
    selectedSkill !== null ||
    selectedMentions.length > 0 ||
    pendingAttachments.length > 0;

  function markEdited() {
    editRevision.current += 1;
    retryNonce.current = null;
  }

  function pickAttachments(files: FileList | null) {
    if (!files?.length) return;
    if (onAttachmentPick(files)) markEdited();
  }

  function updateDraft(value: string) {
    markEdited();
    writeComposerDraft(draftKey, value);
    setDraft(value);
    const mentionMatch = /(?:^|\s)@([\w-]*)$/.exec(value);
    setMentionQuery(mentionMatch ? (mentionMatch[1] ?? "") : null);
    // `/` only at the start of the draft so forced skills expand (`Use skill:` / `/Name` prefix).
    const slashMatch = selectedSkill === null ? /^\/([^\n]*)$/.exec(value) : null;
    const nextSlash = slashMatch ? (slashMatch[1] ?? "") : null;
    if (nextSlash !== null && slashQuery === null) onSlashOpen?.();
    setSlashQuery(nextSlash);
  }

  function focusComposer() {
    textareaRef.current?.focus();
  }

  function insertMention(mention: ComposerMention) {
    markEdited();
    const next = draft.replace(/@([\w-]*)$/, "");
    writeComposerDraft(draftKey, next);
    setDraft(next);
    setMentionQuery(null);
    setMentionHighlightKey(null);
    setSelectedMentions((current) =>
      current.some((selected) => mentionChipKey(selected) === mentionChipKey(mention))
        ? current
        : [...current, mention],
    );
    focusComposer();
  }

  function insertSkill(skill: AgentSkillCatalogEntry) {
    markEdited();
    setSelectedSkill(skill);
    writeComposerDraft(draftKey, "");
    setDraft("");
    setSlashQuery(null);
  }

  function runSlashAction(action: SlashActionId) {
    markEdited();
    writeComposerDraft(draftKey, "");
    setDraft("");
    setSlashQuery(null);
    onSlashAction?.(action);
  }

  function removeLastChip() {
    markEdited();
    if (selectedMentions.length > 0) {
      setSelectedMentions((current) => current.slice(0, -1));
      return;
    }
    if (selectedSkill) setSelectedSkill(null);
  }

  const mentionOptions = useMemo(() => {
    if (mentionQuery === null || !mentionTargets?.length) return [];
    const query = mentionQuery.trim().toLowerCase();
    return mentionTargets
      .filter((target) => !query || target.name.toLowerCase().startsWith(query))
      .slice(0, 10);
  }, [mentionQuery, mentionTargets]);

  useEffect(() => {
    setMentionHighlightKey(null);
  }, [mentionQuery]);

  const activeMentionIndex = clampMentionHighlightIndex(
    mentionOptions.findIndex((mention) => mentionChipKey(mention) === mentionHighlightKey),
    mentionOptions.length,
  );
  const mentionPickerOpen = mentionOptions.length > 0;
  const activeMentionOptionId = mentionPickerOpen
    ? `${mentionListboxId}-option-${activeMentionIndex}`
    : undefined;

  const slashSkillOptions = useMemo(() => {
    if (slashQuery === null) return [];
    const query = slashQuery.trim().toLowerCase();
    const skills = agentSkills ?? [];
    return skills
      .filter((skill) => {
        if (!query) return true;
        return (
          skill.name.toLowerCase().includes(query) ||
          skill.description.toLowerCase().includes(query)
        );
      })
      .slice(0, 8);
  }, [agentSkills, slashQuery]);

  const slashActionOptions = useMemo(() => {
    if (slashQuery === null) return [];
    const query = slashQuery.trim().toLowerCase();
    return SLASH_ACTIONS.filter((action) => !query || action.label.toLowerCase().includes(query));
  }, [slashQuery]);

  const showSlashPicker =
    slashQuery !== null &&
    mentionQuery === null &&
    (slashSkillOptions.length > 0 || slashActionOptions.length > 0);

  async function send() {
    if (!canSend || sending || disabled) return;
    const revision = editRevision.current;
    const clientNonce = retryNonce.current ?? newClientId();
    retryNonce.current = null;
    const text = serializeComposerPrompt(draft, selectedSkill, selectedMentions);
    const submission = beginComposerDraftSubmission(draftKey, draft);
    setDraft("");
    setMentionQuery(null);
    setMentionHighlightKey(null);
    setSlashQuery(null);
    setSelectedSkill(null);
    const mentions = selectedMentions;
    setSelectedMentions([]);
    try {
      // "auto" is the default, so only a chosen routing mode is passed on.
      const accepted =
        (toolRoutingMode === "auto"
          ? await onSend(text, mentions, clientNonce)
          : await onSend(text, mentions, clientNonce, toolRoutingMode)) !== false;
      settleComposerDraftSubmission(draftKey, submission, accepted);
      if (accepted) return;
    } catch {
      settleComposerDraftSubmission(draftKey, submission, false);
      // A rejected callback leaves acceptance unknown; do not restore a possible send.
      return;
    }
    // Restore only an untouched draft, retaining its nonce for an unchanged retry.
    if (editRevision.current !== revision) return;
    retryNonce.current = clientNonce;
    setDraft(draft);
    setSelectedSkill(selectedSkill);
    setSelectedMentions(mentions);
  }

  // Manor takes file drops on the whole chat pane (Shell's drop zone), not just the composer.

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const clipboardData = event.clipboardData;
    // Only intercept real FileList pastes; leave text-only / empty-files native.
    if (disabled || !clipboardData || !isFilePaste(clipboardData)) return;
    event.preventDefault();
    pickAttachments(clipboardData.files);
    const text = clipboardData.getData("text/plain");
    if (!text) return;
    const textarea = event.currentTarget;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    updateDraft(`${draft.slice(0, start)}${text}${draft.slice(end)}`);
    const caret = start + text.length;
    window.requestAnimationFrame(() => {
      textareaRef.current?.setSelectionRange(caret, caret);
    });
  }

  const showComposerPlaceholder =
    draft.length === 0 && selectedSkill === null && selectedMentions.length === 0;

  const replyName = replyTarget ? (replyTargetName ?? previewMessageText(replyTarget)) : "";
  const replyNameRef = useRef(replyName);
  replyNameRef.current = replyName;
  const announceTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(announceTimer.current), []);

  // Arming or retargeting a reply unmounts the control that started it, so
  // focus would drop to <body>; announce on start and when the target changes.
  // The timer lives in a ref: a same-id rerender (e.g. the display name
  // resolving after arming) must not cancel the pending announcement.
  useEffect(() => {
    const prev = prevReplyTarget.current;
    prevReplyTarget.current = replyTarget ?? null;
    if (!replyTarget) {
      // Cancel (or send) within the delay must not let a stale "Replying to"
      // overwrite the cancel announcement — kill the pending timer.
      window.clearTimeout(announceTimer.current);
      // A send disarms the reply without touching the region — drop the stale
      // "Replying to" so it cannot linger or re-announce. An explicit cancel
      // sets "Reply cancelled" in the same event, so only clear "reply" text.
      if (replyAnnouncementKind.current === "reply") {
        replyAnnouncementKind.current = null;
        setReplyAnnouncement("");
      }
      return;
    }
    if (!prev || prev.id !== replyTarget.id) {
      textareaRef.current?.focus();
      // Clear-then-set so a switch between same-author targets re-announces —
      // identical live-region text would otherwise be a no-op.
      setReplyAnnouncement("");
      replyAnnouncementKind.current = null;
      window.clearTimeout(announceTimer.current);
      announceTimer.current = window.setTimeout(() => {
        replyAnnouncementKind.current = "reply";
        setReplyAnnouncement(t`Replying to ${replyNameRef.current}`);
      }, 50);
    }
  }, [replyTarget, replyName, t]);

  return (
    <fieldset
      aria-label={t`Message composer`}
      className="relative z-30 m-0 min-w-0 border-0 px-3 pb-4 pt-3 md:px-6 md:pb-6"
    >
      <div role="status" data-testid="composer-announcement" className="sr-only">
        {replyAnnouncement}
      </div>
      <ComposerError
        sendError={sendError}
        runError={runError}
        runErrorId={runErrorId}
        onRunErrorPresented={onRunErrorPresented}
        onOpenModels={onOpenModels}
        onOpenRunLogs={onOpenRunLogs}
        onDismissError={onDismissError}
        textareaRef={textareaRef}
      />
      {replyTarget ? (
        <ComposerReplyPreview
          author={replyName}
          text={previewMessageText(replyTarget)}
          quote={replyQuote}
          attachment={replyAttachment(replyTarget.blocks)}
          target={artifactTarget}
          onDismiss={() => {
            replyAnnouncementKind.current = "cancelled";
            window.clearTimeout(announceTimer.current);
            onClearReply?.();
            setReplyAnnouncement(t`Reply cancelled`);
            textareaRef.current?.focus();
          }}
        />
      ) : null}
      {attachmentNotice ? (
        <div className="mb-3 rounded-[14px] border border-warning/40 bg-warning/10 px-4 py-2 text-[13px] text-warning">
          {attachmentNotice}
        </div>
      ) : null}
      {pendingAttachments.length ? (
        <div className="mb-3 flex flex-wrap gap-2">
          {pendingAttachments.map((attachment) => (
            <div
              key={attachment.id}
              className="flex items-center gap-2 rounded-full border border-border bg-muted px-3 py-1.5 text-[13px] text-foreground/75"
            >
              {attachment.previewUrl ? (
                <img
                  src={attachment.previewUrl}
                  alt={attachment.file.name}
                  className="h-8 w-8 rounded object-cover"
                />
              ) : (
                <Paperclip size={14} strokeWidth={1.8} />
              )}
              <span className="max-w-[180px] truncate" dir="auto">
                {attachment.file.name}
              </span>
              <button
                type="button"
                aria-label={t`Remove ${attachment.file.name}`}
                onClick={() => {
                  markEdited();
                  onRemoveAttachment(attachment);
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                <X size={13} strokeWidth={2} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {mentionPickerOpen ? (
        <div
          id={mentionListboxId}
          role="listbox"
          aria-label={t`Mentions`}
          data-testid="mention-picker"
          className="mb-2 overflow-hidden rounded-[14px] border border-border bg-muted animate-in fade-in-0 slide-in-from-bottom-1 duration-150 motion-reduce:animate-none"
        >
          {mentionOptions.map((mention, index) => {
            const optionId = `${mentionListboxId}-option-${index}`;
            const highlighted = index === activeMentionIndex;
            return (
              <button
                id={optionId}
                key={mentionChipKey(mention)}
                type="button"
                role="option"
                aria-selected={highlighted}
                aria-label={t`@${mention.name}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insertMention(mention)}
                // Opening the list under a stationary pointer must not steal the keyboard highlight.
                onMouseMove={() => setMentionHighlightKey(mentionChipKey(mention))}
                className={`flex w-full items-start gap-3 px-4 py-2.5 text-start hover:bg-accent ${
                  highlighted ? "bg-accent" : ""
                }`}
              >
                <MentionOptionIcon mention={mention} />
                <span className="min-w-0">
                  <span dir="auto" className="block text-[14px] text-foreground">
                    @{mention.name}
                  </span>
                  {mention.subtitle ? (
                    <span dir="auto" className="block truncate text-[12.5px] text-muted-foreground">
                      {mention.subtitle}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
      {showSlashPicker ? (
        <div
          data-testid="slash-picker"
          className="mb-2 overflow-hidden rounded-[14px] border border-border bg-muted"
        >
          {slashSkillOptions.map((skill) => (
            <button
              key={skill.id}
              type="button"
              aria-label={t`Skill ${skill.name}`}
              onClick={() => insertSkill(skill)}
              className="flex w-full items-start gap-3 px-4 py-2.5 text-start hover:bg-accent"
            >
              <Box size={16} strokeWidth={1.7} className="mt-0.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0">
                <span dir="auto" className="block text-[14px] text-foreground">
                  {skill.name}
                </span>
                <span dir="auto" className="block truncate text-[12.5px] text-muted-foreground">
                  {truncateSlashDescription(skill.description)}
                </span>
              </span>
            </button>
          ))}
          {slashActionOptions.map((action) => {
            const label = slashActionLabel(action.id);
            return (
              <button
                key={action.id}
                type="button"
                aria-label={label}
                onClick={() => runSlashAction(action.id)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-start hover:bg-accent"
              >
                <Settings size={16} strokeWidth={1.7} className="shrink-0 text-muted-foreground" />
                <span className="text-[14px] text-foreground">{label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      <div
        ref={composerBarRef}
        data-testid="composer-bar"
        data-expanded={expanded}
        className={`grid grid-cols-[auto_minmax(0,1fr)_auto] content-end items-center rounded-[26px] border border-border bg-background pe-2.5 ps-3 transition-colors focus-within:border-ring ${
          expanded ? "gap-x-2 gap-y-2 pb-[9px] pt-3" : "gap-x-3.5 py-[9px]"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ATTACHMENT_ACCEPT}
          className="hidden"
          onChange={(event) => pickAttachments(event.target.files)}
        />
        {/* Manor's tool routing button shares the leading slot with the attach button. */}
        <div
          className={`col-start-1 flex shrink-0 items-center gap-2 ${
            expanded ? "row-start-2" : ""
          }`}
        >
          <Button
            variant="ghost"
            size="icon"
            aria-label={t`Attach file`}
            disabled={disabled}
            onClick={() => fileInputRef.current?.click()}
            className="size-8 shrink-0 rounded-full border border-border bg-muted text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Plus size={16} strokeWidth={2} />
          </Button>
          <div ref={routingPickerRef} className="relative shrink-0">
            {/* The layout measures the draft's room from the last leading control, so it holds the ref. */}
            <button
              ref={attachButtonRef}
              type="button"
              aria-label={toolRoutingLabel(toolRoutingMode)}
              aria-pressed={toolRoutingMode !== "auto"}
              onClick={() => setRoutingPickerOpen((open) => !open)}
              title={toolRoutingLabel(toolRoutingMode)}
              className={`grid h-8 w-8 place-items-center rounded-full border ${
                toolRoutingMode === "auto"
                  ? "border-[#26262A] text-[#9A9AA0]"
                  : "border-[#6C6C70] bg-[#1A1A1D] text-[#ECECEE]"
              }`}
            >
              <ToolRoutingIcon mode={toolRoutingMode} size={16} />
            </button>
            {routingPickerOpen ? (
              <div
                role="listbox"
                aria-label={t`Tool routing`}
                data-testid="tool-routing-picker"
                className="absolute bottom-full mb-2 w-72 overflow-hidden rounded-[14px] border border-[#26262A] bg-[#17171A]"
              >
                {TOOL_ROUTING_MODES.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="option"
                    aria-selected={toolRoutingMode === mode}
                    onClick={() => {
                      setToolRoutingMode(mode);
                      setRoutingPickerOpen(false);
                    }}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-start hover:bg-[#1F1F22] ${
                      toolRoutingMode === mode ? "bg-[#1F1F22]" : ""
                    }`}
                  >
                    <ToolRoutingIcon mode={mode} size={15} className="shrink-0 text-[#9A9AA0]" />
                    <span className="min-w-0">
                      <span className="block text-[14px] text-[#ECECEE]">
                        {toolRoutingLabel(mode)}
                      </span>
                      <span className="block text-wrap text-[12.5px] text-[#85858A]">
                        {toolRoutingDescription(mode)}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        <div
          ref={composerFieldRef}
          className={`flex min-w-0 flex-wrap items-end gap-1.5 ${
            expanded ? "col-span-3 row-start-1 px-1.5" : "col-start-2"
          }`}
        >
          {selectedSkill ? (
            <span
              data-testid="skill-chip"
              className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 text-[13px] text-foreground"
            >
              <Box size={13} strokeWidth={1.7} className="shrink-0 text-muted-foreground/70" />
              <span dir="auto" className="truncate">
                {selectedSkill.name}
              </span>
              <button
                type="button"
                aria-label={t`Remove skill ${selectedSkill.name}`}
                onClick={() => {
                  markEdited();
                  setSelectedSkill(null);
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                <X size={12} strokeWidth={2} />
              </button>
            </span>
          ) : null}
          {selectedMentions.map((mention) => (
            <span
              key={mentionChipKey(mention)}
              data-testid="mention-chip"
              data-mention-kind={mention.kind}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 text-[13px] text-foreground"
            >
              <MentionChipIcon mention={mention} />
              <span dir="auto" className="truncate">
                {mention.name}
              </span>
              <button
                type="button"
                aria-label={t`Remove mention ${mention.name}`}
                onClick={() => {
                  markEdited();
                  setSelectedMentions((current) =>
                    current.filter(
                      (selected) => mentionChipKey(selected) !== mentionChipKey(mention),
                    ),
                  );
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                <X size={12} strokeWidth={2} />
              </button>
            </span>
          ))}
          <HoldToTalkStrip talk={talk} />
          <textarea
            ref={textareaRef}
            hidden={talk.recording !== null}
            value={draft}
            onChange={(event) => updateDraft(event.target.value)}
            onPaste={handlePaste}
            onKeyDown={(event) => {
              if (
                event.key === "Backspace" &&
                draft.length === 0 &&
                (selectedSkill !== null || selectedMentions.length > 0)
              ) {
                event.preventDefault();
                removeLastChip();
                return;
              }
              const action = resolveMentionPickerKey({
                key: event.key,
                shiftKey: event.shiftKey,
                ctrlKey: event.ctrlKey,
                metaKey: event.metaKey,
                enterToSend,
                isComposing: event.nativeEvent.isComposing || event.keyCode === 229,
                optionCount: mentionOptions.length,
                highlightedIndex: activeMentionIndex,
              });
              if (action.type === "complete") {
                const mention = mentionOptions[action.index];
                if (!mention) return;
                event.preventDefault();
                insertMention(mention);
                return;
              }
              if (action.type === "move") {
                event.preventDefault();
                setMentionHighlightKey(mentionChipKey(mentionOptions[action.index]!));
                return;
              }
              if (action.type === "dismiss") {
                event.preventDefault();
                setMentionQuery(null);
                setMentionHighlightKey(null);
                return;
              }
              if (action.type === "send") {
                event.preventDefault();
                void send();
              }
            }}
            disabled={disabled}
            placeholder={
              showComposerPlaceholder
                ? activeName
                  ? t`Message ${activeName}`
                  : t`Message…`
                : undefined
            }
            aria-label={activeName ? t`Message ${activeName}` : t`Message`}
            role="combobox"
            aria-autocomplete="list"
            aria-haspopup="listbox"
            aria-expanded={mentionPickerOpen}
            aria-controls={mentionPickerOpen ? mentionListboxId : undefined}
            aria-activedescendant={activeMentionOptionId}
            name="chat-message"
            autoComplete="off"
            dir="auto"
            rows={1}
            className="rk-scroll max-h-25 min-h-[24px] min-w-[8rem] flex-1 resize-none overflow-y-auto bg-transparent py-0.5 text-[15.5px] leading-6 text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-40"
          />
        </div>
        <div
          ref={composerActionsRef}
          className={`col-start-3 flex shrink-0 items-center gap-2 justify-self-end ${
            expanded ? "row-start-2" : ""
          }`}
        >
          {talk.recording?.locked ? (
            <HoldToTalkControls talk={talk} />
          ) : running ? (
            <>
              {phoneCallsEnabled && draft.trim().length === 0 ? (
                <HoldToTalkControls talk={talk} disabled={disabled || onCall} />
              ) : null}
              <Button
                size="icon"
                aria-label={t`Send`}
                disabled={sending || !canSend || disabled}
                onClick={send}
                className="size-8 rounded-full bg-white text-black hover:bg-white/90 shadow-sm transition-transform active:scale-95"
              >
                <ArrowUp size={16} strokeWidth={2.2} />
              </Button>
              {/* Manor's thinking ring: 28px plus its 2px padding matches the 32px controls. */}
              <span className="rk-thinking-ring">
                <button
                  type="button"
                  aria-label={t`Stop`}
                  disabled={sending}
                  onClick={() => void onStop()}
                  className="relative grid h-7 w-7 place-items-center rounded-full border border-[#34343A] bg-[#0E0E10] text-[#C9C9CE] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#A6A6AD] disabled:opacity-50"
                >
                  <Square size={11} strokeWidth={0} fill="currentColor" />
                </button>
              </span>
            </>
          ) : (
            <>
              {phoneCallsEnabled && draft.trim().length === 0 ? (
                <HoldToTalkControls talk={talk} disabled={disabled || onCall} />
              ) : null}
              <Button
                size="icon"
                aria-label={t`Send`}
                disabled={sending || !canSend || disabled}
                onClick={send}
                className="size-8 shrink-0 rounded-full bg-white text-black hover:bg-white/90 shadow-sm transition-transform active:scale-95 disabled:bg-white/10 disabled:text-muted-foreground/30 disabled:shadow-none"
              >
                <ArrowUp size={16} strokeWidth={2.2} />
              </Button>
            </>
          )}
        </div>
      </div>
    </fieldset>
  );
});

function ToolRoutingIcon({
  mode,
  size,
  className,
}: {
  mode: ToolRoutingMode;
  size: number;
  className?: string;
}) {
  if (mode === "vm") return <Cpu size={size} strokeWidth={1.7} className={className} />;
  if (mode === "plugins") return <Puzzle size={size} strokeWidth={1.7} className={className} />;
  return <Blend size={size} strokeWidth={1.7} className={className} />;
}
