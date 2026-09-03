import { useLingui } from "@lingui/react/macro";
import { ChatMarkdown } from "@rakazo/chat-ui/web";
import type { MessageBlock } from "@rakazo/contracts";
import { formatDurationMs } from "@rakazo/core";
import { ChevronRight } from "lucide-react";
import { useEffect, useRef } from "react";
import { ToolSteps } from "./ToolActivityDisclosure";

export type ActivityItem = Extract<MessageBlock, { kind: "thinking" } | { kind: "steps" }>;

export type NarrationEntry =
  | { kind: "activity"; items: ActivityItem[] }
  | { kind: "prose"; block: Extract<MessageBlock, { kind: "text" } | { kind: "progress" }> };

/**
 * Consecutive thoughts and tool steps form one timeline; prose between them
 * stays prose. Anything else is dropped here (the caller only passes
 * narration blocks).
 */
export function groupNarrationBlocks(blocks: readonly MessageBlock[]): NarrationEntry[] {
  const entries: NarrationEntry[] = [];
  for (const block of blocks) {
    if (block.kind === "thinking" || block.kind === "steps") {
      const last = entries.at(-1);
      if (last?.kind === "activity") last.items.push(block);
      else entries.push({ kind: "activity", items: [block] });
    } else if (block.kind === "text" || block.kind === "progress") {
      entries.push({ kind: "prose", block });
    }
  }
  return entries;
}

/**
 * The bot's reasoning and actions for one stretch of a turn, on a single
 * rail. Live: open, the current thought flowing in and the current action
 * pulsing. Done: one line, "Thought for 32s · 6 actions", expandable.
 */
export function ActivityTimeline({ items, live }: { items: ActivityItem[]; live: boolean }) {
  const { t } = useLingui();
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const current = live ? items.at(-1) : undefined;
  const thinkingMs = items.reduce(
    (total, item) => total + (item.kind === "thinking" ? (item.durationMs ?? 0) : 0),
    0,
  );
  const stepsMs = items.reduce(
    (total, item) => total + (item.kind === "steps" ? (item.durationMs ?? 0) : 0),
    0,
  );
  const actions = items.reduce(
    (total, item) =>
      total + (item.kind === "steps" ? item.steps.reduce((n, step) => n + step.count, 0) : 0),
    0,
  );
  const duration = formatDurationMs(thinkingMs + stepsMs);
  const thoughtPart =
    thinkingMs + stepsMs < 1000 || !duration ? t`Thought for a moment` : t`Thought for ${duration}`;
  const doneLabel =
    actions === 0
      ? thoughtPart
      : actions === 1
        ? t`${thoughtPart} · 1 action`
        : t`${thoughtPart} · ${actions} actions`;
  const liveLabel = current?.kind === "steps" ? t`Working` : t`Thinking`;
  const lastText = items.map((item) => (item.kind === "thinking" ? item.text.length : 0)).join();

  useEffect(() => {
    if (!live || !bodyRef.current) return;
    bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [live, lastText]);

  const rail = (
    <div className="rk-tl-rail">
      {items.map((item, index) => {
        const isCurrent = live && index === items.length - 1;
        if (item.kind === "thinking") {
          return (
            <div key={index} className={`rk-tl-thought${isCurrent ? " rk-tl-thought-live" : ""}`}>
              <ChatMarkdown streaming={isCurrent}>{item.text}</ChatMarkdown>
            </div>
          );
        }
        return (
          <div key={index} className="rk-tl-steps">
            <ToolSteps
              steps={item.steps}
              currentIndex={isCurrent ? item.steps.length - 1 : undefined}
            />
          </div>
        );
      })}
    </div>
  );

  if (live) {
    return (
      <div data-testid="activity-timeline" data-live className="rk-tl">
        <div className="rk-tl-label">
          <span className="rk-tl-shimmer">{liveLabel}</span>
          <span className="rk-tl-dot" aria-hidden />
        </div>
        <div ref={bodyRef} className="rk-tl-body rk-tl-body-live">
          {rail}
        </div>
      </div>
    );
  }

  return (
    <details data-testid="activity-timeline" className="group rk-tl">
      <summary className="flex min-h-6 w-fit cursor-pointer list-none items-center gap-1 rounded-md py-0.5 pe-1.5 text-[13px] font-medium text-[#85858A] outline-none hover:text-[#C9C9CE] focus-visible:ring-2 focus-visible:ring-[#85858A] focus-visible:ring-offset-2 focus-visible:ring-offset-[#1A1A1D]">
        <ChevronRight
          aria-hidden
          size={14}
          strokeWidth={1.8}
          className="transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none"
        />
        {doneLabel}
      </summary>
      <div className="rk-tl-body mt-2">{rail}</div>
    </details>
  );
}
