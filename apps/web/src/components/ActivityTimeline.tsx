import { useLingui } from "@lingui/react/macro";
import { ChatMarkdown } from "@rakazo/chat-ui/web";
import type { MessageBlock } from "@rakazo/contracts";
import { formatDurationMs } from "@rakazo/core";
import { useEffect, useState } from "react";
import { ManorOrb } from "./beautiful-ui/ManorOrb";

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
 * Prose is "interim" when the bot keeps working after it: it shares the rail
 * with the reasoning instead of reading as the final answer.
 */
export function isInterimProse(entries: readonly NarrationEntry[], index: number): boolean {
  return entries.slice(index + 1).some((entry) => entry.kind === "activity");
}

/**
 * The bot's reasoning and actions for one stretch of a turn, always in the
 * open: thoughts as quiet italic paragraphs behind a hairline, tool calls as
 * plain one-line steps. Nothing folds away once the turn completes.
 */
export function ActivityTimeline({ items, live }: { items: ActivityItem[]; live: boolean }) {
  return (
    <div data-testid="activity-timeline" data-live={live || undefined} className="rk-tl">
      <div className="rk-tl-rail">
        {items.map((item, index) => {
          const isCurrent = live && index === items.length - 1;
          if (item.kind === "thinking") {
            return (
              <div
                key={index}
                data-testid="thought"
                className={`rk-tl-thought${isCurrent ? " rk-tl-thought-live" : ""}`}
              >
                <ChatMarkdown streaming={isCurrent}>{item.text}</ChatMarkdown>
              </div>
            );
          }
          return (
            <div key={index} className="rk-tl-steps" data-testid="tool-rows">
              {item.steps.map((step, stepIndex) => {
                const stepLive = isCurrent && stepIndex === item.steps.length - 1;
                return (
                  <div
                    key={stepIndex}
                    className={`rk-tl-step${stepLive ? " rk-tl-step-live" : ""}`}
                    dir="auto"
                  >
                    {step.label}
                    {step.count > 1 ? ` ×${step.count}` : ""}
                    {stepLive ? "…" : ""}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function useElapsed(startedAt: string | null | undefined): string {
  const [now, setNow] = useState(() => Date.now());
  const [mountedAt] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const start = startedAt ? Date.parse(startedAt) : mountedAt;
  return formatDurationMs(Math.max(0, now - (Number.isFinite(start) ? start : mountedAt))) ?? "0s";
}

/** The footer under a live turn: the orb, elapsed time, and who we are waiting on. */
export function LiveStatusLine({
  startedAt,
  name,
}: {
  startedAt: string | null | undefined;
  name: string;
}) {
  const { t } = useLingui();
  const elapsed = useElapsed(startedAt);
  return (
    <div data-testid="live-status" className="rk-tl-status">
      <ManorOrb size={18} />
      <span className="rk-tl-status-text">
        <span>{elapsed}</span>
        <span aria-hidden> · </span>
        <span>{t`Waiting for ${name}…`}</span>
      </span>
    </div>
  );
}
