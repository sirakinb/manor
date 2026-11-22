import { t } from "@lingui/core/macro";
import type { CSSProperties, PointerEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { useEventListener } from "../../lib/use-event-listener";
import { useBotsSidebarWidth } from "./sidebar/sidebar-layout";

const STORAGE_KEY = "rakazo:right-panel-width";
const MIN_WIDTH = 320;
const DEFAULT_WIDTH = 384;
/** Manor's files and run-log panels hold an editor and a log, so they start wider. */
const WIDE_DEFAULT_WIDTH = 560;
const ABSOLUTE_MAX = 1000;
const MIN_CHAT_WIDTH = 320;

function maximumWidth(reservedLeadingPx: number, viewportWidth = window.innerWidth) {
  return Math.max(
    MIN_WIDTH,
    Math.min(ABSOLUTE_MAX, viewportWidth - reservedLeadingPx - MIN_CHAT_WIDTH),
  );
}

/** The width the user chose, or null while they have never resized the panel. */
function readSavedWidth() {
  try {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    if (saved >= MIN_WIDTH) return Math.min(ABSOLUTE_MAX, saved);
  } catch {
    /* Storage may be disabled. */
  }
  return null;
}

export function ResizableSidePanel({
  open,
  panel,
  children,
}: {
  open: boolean;
  panel: string;
  children: ReactNode;
}) {
  const reservedLeadingPx = useBotsSidebarWidth();
  const [savedWidth, setSavedWidth] = useState(readSavedWidth);
  const preferredWidth =
    savedWidth ?? (panel === "files" || panel === "logs" ? WIDE_DEFAULT_WIDTH : DEFAULT_WIDTH);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const maxWidth = maximumWidth(reservedLeadingPx, viewportWidth);
  const overlay = viewportWidth - reservedLeadingPx < MIN_CHAT_WIDTH + MIN_WIDTH;
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; width: number; direction: number } | null>(null);
  const width = Math.max(MIN_WIDTH, Math.min(maxWidth, preferredWidth));

  useEffect(() => {
    if (savedWidth === null) return;
    try {
      localStorage.setItem(STORAGE_KEY, String(savedWidth));
    } catch {
      /* Storage may be disabled. */
    }
  }, [savedWidth]);

  useEffect(() => {
    setViewportWidth(window.innerWidth);
  }, []);
  useEventListener(window, "resize", () => setViewportWidth(window.innerWidth));

  function stopDrag(event: PointerEvent<HTMLHRElement>) {
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function setWidthFromUser(next: number) {
    setSavedWidth(Math.max(MIN_WIDTH, Math.min(maximumWidth(reservedLeadingPx), next)));
  }

  return (
    <aside
      data-testid="side-panel"
      data-panel={panel}
      data-overlay={overlay || undefined}
      style={{ "--panel-width": `${width}px` } as CSSProperties}
      className={`absolute inset-y-0 end-0 z-20 flex min-h-0 shrink-0 flex-col overflow-hidden bg-background ${overlay ? "md:absolute" : "md:relative"} ${dragging ? "" : "transition-[width] duration-150 ease-out"} ${open ? "w-full max-w-[384px] border-s border-sidebar-border md:w-(--panel-width) md:max-w-none" : "pointer-events-none w-0"}`}
    >
      {open ? (
        <hr
          tabIndex={0}
          aria-label={t`Resize panel`}
          aria-orientation="vertical"
          aria-valuemin={MIN_WIDTH}
          aria-valuemax={maxWidth}
          aria-valuenow={Math.round(width)}
          className={`absolute inset-y-0 start-0 z-30 m-0 hidden h-full w-2 touch-none cursor-col-resize border-0 bg-transparent hover:bg-border focus-visible:bg-border focus-visible:outline-none ${overlay ? "" : "md:block"}`}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = {
              x: event.clientX,
              width,
              direction: document.documentElement.dir === "rtl" ? -1 : 1,
            };
            setDragging(true);
          }}
          onPointerMove={(event) => {
            if (drag.current)
              setWidthFromUser(
                drag.current.width + (drag.current.x - event.clientX) * drag.current.direction,
              );
          }}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
          onLostPointerCapture={() => {
            drag.current = null;
            setDragging(false);
          }}
          onKeyDown={(event) => {
            const direction = document.documentElement.dir === "rtl" ? -1 : 1;
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              setWidthFromUser(width + (event.key === "ArrowLeft" ? 32 : -32) * direction);
            } else if (event.key === "Home") {
              event.preventDefault();
              setWidthFromUser(MIN_WIDTH);
            } else if (event.key === "End") {
              event.preventDefault();
              setWidthFromUser(maximumWidth(reservedLeadingPx));
            }
          }}
        />
      ) : null}
      {children}
    </aside>
  );
}
