import { t } from "@lingui/core/macro";
import type { ThreadMessage } from "@rakazo/contracts";
import { previewMessageText as previewText } from "@rakazo/core";

export type PendingAttachment = {
  id: string;
  threadKey: string;
  file: File;
  previewUrl?: string;
};

/** Identity colour for bots the roster no longer knows about. */
export const FALLBACK_BOT_COLOR = "#85858A";

/**
 * A bot message drawn as Manor's narration: prose, thoughts and tool steps only. A live one
 * carries its own status line under the activity timeline.
 */
export function isNarrationMessage(message: Pick<ThreadMessage, "role" | "blocks">): boolean {
  return (
    message.role === "bot" &&
    message.blocks.length > 0 &&
    message.blocks.every(
      (block) =>
        block.kind === "text" ||
        block.kind === "progress" ||
        block.kind === "steps" ||
        block.kind === "thinking",
    )
  );
}
export function previewMessageText(message: ThreadMessage): string {
  return previewText(message, { photo: t`Photo`, attachment: t`Attachment`, message: t`Message` });
}
