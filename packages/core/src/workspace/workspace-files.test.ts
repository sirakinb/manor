import type { WorkspaceFileRequest, WorkspaceFileResult } from "@rakazo/contracts";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceFilesController } from "./workspace-files.js";

const first = {
  kind: "file" as const,
  path: "notes.txt",
  revision: "a".repeat(64),
  content: "original",
  mimeType: "text/plain",
  size: 8,
};
const list = { kind: "list" as const, entries: [], truncated: false };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("shared workspace file controller", () => {
  it("keeps dirty content when the computer changes a file and disables stale saves", async () => {
    const request = vi.fn(
      async ({ operation }: WorkspaceFileRequest): Promise<WorkspaceFileResult> =>
        operation.action === "read"
          ? first
          : operation.action === "inspect"
            ? { kind: "revision", revision: "b".repeat(64) }
            : list,
    );
    const controller = new WorkspaceFilesController("bot-1", request);
    await controller.open("notes.txt");
    controller.setDraft("my draft");
    await controller.checkOpenFile();
    expect(controller.snapshot().file).toMatchObject({
      draft: "my draft",
      stale: true,
      content: "original",
    });
    expect(await controller.save()).toBe(false);
    expect(request.mock.calls.some(([request]) => request.operation.action === "write")).toBe(
      false,
    );
  });

  it("ignores reads and lists from a previous folder or location", async () => {
    const oldFile = deferred<WorkspaceFileResult>();
    const oldList = deferred<WorkspaceFileResult>();
    const controller = new WorkspaceFilesController("bot-1", async ({ operation, location }) => {
      if (operation.action === "read") return oldFile.promise;
      return location === "bot"
        ? oldList.promise
        : {
            kind: "list",
            entries: [{ path: "shared.txt", kind: "file", size: 1 }],
            truncated: false,
          };
    });
    const pendingList = controller.refresh();
    const pendingOpen = controller.open("notes.txt");
    await controller.browse("", "shared");
    oldList.resolve(list);
    oldFile.resolve(first);
    await Promise.all([pendingList, pendingOpen]);
    expect(controller.snapshot()).toMatchObject({
      location: "shared",
      file: null,
      entries: [{ path: "shared.txt" }],
    });
  });

  it("serializes UI mutations and preserves edits made during a save", async () => {
    const save = deferred<WorkspaceFileResult>();
    const request = vi.fn(
      async ({ operation }: WorkspaceFileRequest): Promise<WorkspaceFileResult> => {
        if (operation.action === "read") return first;
        if (operation.action === "write") return save.promise;
        return list;
      },
    );
    const controller = new WorkspaceFilesController("bot-1", request);
    await controller.open("notes.txt");
    controller.setDraft("first draft");
    const pending = controller.save();
    expect(
      await controller.perform({ action: "delete", path: "notes.txt", revision: first.revision }),
    ).toBe(false);
    controller.setDraft("next draft");
    save.resolve({ kind: "revision", revision: "c".repeat(64) });
    await pending;
    expect(controller.snapshot().file).toMatchObject({
      content: "first draft",
      draft: "next draft",
      revision: "c".repeat(64),
    });
    expect(controller.dirty).toBe(true);
  });

  it("does not retry failures forever and keeps the editable draft", async () => {
    const request = vi.fn(
      async ({ operation }: WorkspaceFileRequest): Promise<WorkspaceFileResult> => {
        if (operation.action === "read") return first;
        throw new Error("Computer is busy");
      },
    );
    const controller = new WorkspaceFilesController("bot-1", request);
    await controller.open("notes.txt");
    controller.setDraft("draft");
    expect(await controller.save()).toBe(false);
    expect(controller.snapshot()).toMatchObject({
      busy: false,
      error: "Computer is busy",
      file: { draft: "draft" },
    });
    expect(request).toHaveBeenCalledTimes(2);
  });
});
