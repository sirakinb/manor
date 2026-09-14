import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { executeLocalFolderRpc } from "./local-folder-runtime.js";

describe("executeLocalFolderRpc", () => {
  it("lists, reads, writes, and shells inside the shared folder", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "local-folder-"));
    await writeFile(path.join(root, "hello.txt"), "hi");

    const listed = (await executeLocalFolderRpc({
      root,
      method: "list_files",
      params: { path: "" },
    })) as Array<{ path: string }>;
    expect(listed.some((entry) => entry.path === "hello.txt")).toBe(true);

    const read = (await executeLocalFolderRpc({
      root,
      method: "read_file",
      params: { path: "hello.txt" },
    })) as { contentBase64: string };
    expect(Buffer.from(read.contentBase64, "base64").toString("utf8")).toBe("hi");

    await executeLocalFolderRpc({
      root,
      method: "write_file",
      params: { path: "note.txt", contentBase64: Buffer.from("ok").toString("base64") },
    });
    expect(await readFile(path.join(root, "note.txt"), "utf8")).toBe("ok");

    const shell = (await executeLocalFolderRpc({
      root,
      method: "shell",
      params: { argv: ["bash", "-lc", "pwd"] },
    })) as { code: number; stdout: string };
    expect(shell.code).toBe(0);
    expect(shell.stdout.trim()).toBe(root);
  });

  it("rejects unknown methods", async () => {
    await expect(
      executeLocalFolderRpc({ root: "/tmp", method: "computer_act", params: {} }),
    ).rejects.toThrow(/Unknown local computer method/);
  });
});
