import { describe, expect, it, vi } from "vitest";
import { isFileDrag, pastedFiles, revokePendingAttachmentPreviews } from "./pending-attachments.js";

function dragData(types: string[], itemKinds: string[] = []) {
  return {
    types,
    items: itemKinds.map((kind) => ({ kind })),
  } as unknown as DataTransfer;
}

describe("isFileDrag", () => {
  it("recognizes files advertised by the drag data", () => {
    expect(isFileDrag(dragData(["Files"]))).toBe(true);
  });

  it("recognizes file items when the Files type is not exposed", () => {
    expect(isFileDrag(dragData([], ["file"]))).toBe(true);
  });

  it("ignores text and other drags", () => {
    expect(isFileDrag(dragData(["text/plain"], ["string"]))).toBe(false);
    expect(isFileDrag(null)).toBe(false);
  });
});

describe("revokePendingAttachmentPreviews", () => {
  it("revokes each preview URL and skips entries without one", () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    revokePendingAttachmentPreviews([{ previewUrl: "blob:a" }, {}, { previewUrl: "blob:b" }]);
    expect(revoke).toHaveBeenCalledTimes(2);
    expect(revoke).toHaveBeenCalledWith("blob:a");
    expect(revoke).toHaveBeenCalledWith("blob:b");
    revoke.mockRestore();
  });
});

describe("pastedFiles", () => {
  const png = new File([new Uint8Array([1, 2, 3])], "shot.png", { type: "image/png" });

  it("returns the clipboard's files when present", () => {
    const data = { files: [png], items: [] } as unknown as DataTransfer;
    expect(pastedFiles(data)).toEqual([png]);
  });

  it("falls back to file items when files is empty", () => {
    const data = {
      files: [],
      items: [
        { kind: "string", getAsFile: () => null },
        { kind: "file", getAsFile: () => png },
      ],
    } as unknown as DataTransfer;
    expect(pastedFiles(data)).toEqual([png]);
  });

  it("returns nothing for text-only pastes", () => {
    const data = {
      files: [],
      items: [{ kind: "string", getAsFile: () => null }],
    } as unknown as DataTransfer;
    expect(pastedFiles(data)).toEqual([]);
    expect(pastedFiles(null)).toEqual([]);
  });
});
