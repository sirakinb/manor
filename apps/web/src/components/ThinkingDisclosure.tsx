import { useLingui } from "@lingui/react/macro";
import { ChevronRight } from "lucide-react";
import { useEffect, useRef } from "react";

/**
 * The bot's reasoning. While it streams, the thought is open and flows in a
 * quieter voice than the reply; once the reply starts it folds to one line.
 */
export function ThinkingDisclosure({
  text,
  live,
  durationMs,
}: {
  text: string;
  live: boolean;
  durationMs?: number;
}) {
  const { t } = useLingui();
  const seconds = durationMs === undefined ? 0 : Math.round(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  const doneLabel =
    durationMs === undefined || durationMs < 1000
      ? t`Thought for a moment`
      : seconds < 60
        ? t`Thought for ${seconds}s`
        : rest
          ? t`Thought for ${minutes}m ${rest}s`
          : t`Thought for ${minutes}m`;
  const bodyRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!live || !bodyRef.current) return;
    bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [live, text]);

  if (live) {
    return (
      <div data-testid="thinking-live" className="rk-think">
        <div className="rk-think-label">
          <span className="rk-think-shimmer">{t`Thinking`}</span>
        </div>
        <div ref={bodyRef} className="rk-think-body rk-think-body-live">
          <div key={text.length} className="rk-think-text rk-think-text-in">
            {text}
            <span className="rk-think-caret" aria-hidden />
          </div>
        </div>
      </div>
    );
  }

  return (
    <details data-testid="thinking-done" className="group rk-think">
      <summary className="flex min-h-6 w-fit cursor-pointer list-none items-center gap-1 rounded-md py-0.5 pe-1.5 text-[13px] font-medium text-[#85858A] outline-none hover:text-[#C9C9CE] focus-visible:ring-2 focus-visible:ring-[#85858A] focus-visible:ring-offset-2 focus-visible:ring-offset-[#1A1A1D]">
        <ChevronRight
          aria-hidden
          size={14}
          strokeWidth={1.8}
          className="transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none"
        />
        {doneLabel}
      </summary>
      <div className="rk-think-body mt-1.5">
        <div className="rk-think-text">{text}</div>
      </div>
    </details>
  );
}
