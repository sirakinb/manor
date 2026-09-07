import { useLingui } from "@lingui/react/macro";
import { type CSSProperties, type ReactNode, useLayoutEffect, useRef, useState } from "react";

const STORAGE_KEY = "manor.side-panel-width";
const MIN_WIDTH = 320;

export function ResizableSidePanel({
  open,
  panel,
  children,
}: {
  open: boolean;
  panel: string | null;
  children: ReactNode;
}) {
  const { t } = useLingui();
  const ref = useRef<HTMLElement>(null);
  const [maxWidth, setMaxWidth] = useState(640);
  const [savedWidth, setSavedWidth] = useState<number | null>(() => {
    try {
      const value = Number(localStorage.getItem(STORAGE_KEY));
      return Number.isFinite(value) && value >= MIN_WIDTH ? value : null;
    } catch {
      return null;
    }
  });
  const drag = useRef<{ x: number; width: number; rtl: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const defaultWidth = panel === "files" || panel === "logs" ? 560 : 384;
  const width = Math.min(maxWidth, Math.max(MIN_WIDTH, savedWidth ?? defaultWidth));
  const updateWidth = (value: number) => {
    const next = Math.round(Math.min(maxWidth, Math.max(MIN_WIDTH, value)));
    setSavedWidth(next);
    try {
      localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      /* Storage is optional. */
    }
  };
  useLayoutEffect(() => {
    const shell = ref.current?.parentElement;
    if (!shell) return;
    const measure = () => setMaxWidth(Math.max(MIN_WIDTH, shell.clientWidth - 316 - 320));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(shell);
    return () => observer.disconnect();
  }, []);
  return (
    <aside
      ref={ref}
      id="agent-side-panel"
      data-testid="side-panel"
      data-panel={panel ?? "closed"}
      style={{ "--side-panel-width": `${width}px` } as CSSProperties}
      className={`absolute inset-y-0 end-0 z-40 flex min-h-0 shrink-0 flex-col bg-[#0A0A0B] lg:relative lg:z-20 ${open ? "w-full border-s border-[#141416] lg:w-[var(--side-panel-width)]" : "pointer-events-none w-0 overflow-hidden"}`}
    >
      {open ? (
        <hr
          aria-label={t`Resize panel`}
          aria-controls="agent-side-panel"
          aria-orientation="vertical"
          aria-valuemin={MIN_WIDTH}
          aria-valuemax={maxWidth}
          aria-valuenow={Math.round(width)}
          tabIndex={0}
          data-testid="panel-resize-handle"
          className="absolute inset-y-0 -start-1 z-50 m-0 hidden h-auto w-2 cursor-col-resize touch-none border-0 bg-transparent hover:bg-[#8B5CF6]/30 focus-visible:bg-[#8B5CF6]/30 focus-visible:outline focus-visible:outline-[#8B5CF6] lg:block"
          onDoubleClick={() => updateWidth(defaultWidth)}
          onKeyDown={(event) => {
            const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            updateWidth(
              event.key === "Home"
                ? MIN_WIDTH
                : event.key === "End"
                  ? maxWidth
                  : width + ((event.key === "ArrowLeft") !== rtl ? 32 : -32),
            );
          }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            drag.current = {
              x: event.clientX,
              width,
              rtl: getComputedStyle(event.currentTarget).direction === "rtl",
            };
            event.currentTarget.setPointerCapture(event.pointerId);
            setDragging(true);
          }}
          onPointerMove={(event) => {
            if (drag.current)
              updateWidth(
                drag.current.width + (drag.current.x - event.clientX) * (drag.current.rtl ? -1 : 1),
              );
          }}
          onPointerUp={(event) => {
            drag.current = null;
            setDragging(false);
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onLostPointerCapture={() => {
            drag.current = null;
            setDragging(false);
          }}
        />
      ) : null}
      <div
        className={`min-h-0 h-full overflow-hidden ${dragging ? "pointer-events-none select-none" : ""}`}
      >
        {children}
      </div>
    </aside>
  );
}
