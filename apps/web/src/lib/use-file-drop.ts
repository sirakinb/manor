import { type DragEvent, useCallback, useRef, useState } from "react";
import { isFileDrag } from "./pending-attachments";

/**
 * Turns any element into a file drop target. Tracks nested dragenter/leave
 * pairs so `dragging` stays true while the cursor moves across children and
 * flips off only when the drag actually leaves the element (or lands).
 */
export function useFileDropZone<T extends HTMLElement>({
  disabled,
  onFiles,
}: {
  disabled: boolean;
  onFiles: (files: FileList) => void;
}) {
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);

  const reset = useCallback(() => {
    depth.current = 0;
    setDragging(false);
  }, []);

  const onDragEnter = useCallback(
    (event: DragEvent<T>) => {
      if (!isFileDrag(event.dataTransfer)) return;
      event.preventDefault();
      if (disabled) return reset();
      depth.current += 1;
      setDragging(true);
    },
    [disabled, reset],
  );

  const onDragOver = useCallback(
    (event: DragEvent<T>) => {
      const dataTransfer = event.dataTransfer;
      if (!isFileDrag(dataTransfer)) return;
      event.preventDefault();
      dataTransfer.dropEffect = disabled ? "none" : "copy";
      if (disabled) return reset();
      setDragging(true);
    },
    [disabled, reset],
  );

  const onDragLeave = useCallback(
    (event: DragEvent<T>) => {
      if (!isFileDrag(event.dataTransfer)) return;
      if (disabled) return reset();
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    },
    [disabled, reset],
  );

  const onDrop = useCallback(
    (event: DragEvent<T>) => {
      const dataTransfer = event.dataTransfer;
      if (!isFileDrag(dataTransfer)) return;
      event.preventDefault();
      reset();
      if (!disabled) onFiles(dataTransfer.files);
    },
    [disabled, onFiles, reset],
  );

  return { dragging, handlers: { onDragEnter, onDragOver, onDragLeave, onDrop } };
}
