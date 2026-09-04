export type PendingAttachmentPreview = {
  previewUrl?: string;
};

export function isFileDrag(dataTransfer: Pick<DataTransfer, "types" | "items"> | null): boolean {
  if (!dataTransfer) return false;
  return (
    Array.from(dataTransfer.types).includes("Files") ||
    Array.from(dataTransfer.items).some((item) => item.kind === "file")
  );
}

export function revokePendingAttachmentPreviews(
  attachments: readonly PendingAttachmentPreview[],
): void {
  for (const attachment of attachments) {
    if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
  }
}

/**
 * Files carried by a paste (screenshots, copied images). Browsers expose them
 * both as `files` and as `items` of kind "file"; prefer the former and fall
 * back to the latter for clipboards that only fill one of them.
 */
export function pastedFiles(clipboardData: Pick<DataTransfer, "files" | "items"> | null): File[] {
  if (!clipboardData) return [];
  const files = Array.from(clipboardData.files ?? []);
  if (files.length) return files;
  return Array.from(clipboardData.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}
