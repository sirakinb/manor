import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { LOCAL_COMPUTER_GUI_MESSAGE, LOCAL_COMPUTER_PATH_ESCAPE_MESSAGE } from "@rakazo/core";
import {
  listLocalFolder,
  readLocalFolderFile,
  runLocalFolderShell,
  writeLocalFolderFile,
} from "@rakazo/core/node/local-folder-runtime";
import { afterAll, describe, expect, it } from "vitest";
import { FakeSandboxProvider } from "./fake-sandbox.js";
import { createRunSandbox } from "./host-aware-sandbox.js";
import { MemoryLocalComputerGateway } from "./local-computer-gateway.js";
import { LocalSandboxProvider } from "./local-sandbox.js";

const ctx = {
  operationId: "op",
  traceId: "tr",
  spaceId: "space-1",
  userId: "user-1",
  signal: new AbortController().signal,
};

describe("local folder runtime", () => {
  const roots: string[] = [];

  afterAll(async () => {
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  });

  async function folder() {
    const root = await mkdtemp(path.join(tmpdir(), "manor-local-"));
    roots.push(root);
    return root;
  }

  it("lists, reads, writes, and shells inside the picked folder", async () => {
    const root = await folder();
    await writeFile(path.join(root, "readme.txt"), "hello\n");
    const entries = await listLocalFolder(root, "");
    expect(entries.some((entry) => entry.path.endsWith("readme.txt"))).toBe(true);
    await writeLocalFolderFile(root, "notes/scratch.txt", Buffer.from("ok"));
    expect(new TextDecoder().decode(await readLocalFolderFile(root, "notes/scratch.txt"))).toBe(
      "ok",
    );
    const shell = await runLocalFolderShell(root, { argv: ["bash", "-lc", "pwd && printf hi"] });
    expect(shell.code).toBe(0);
    expect(shell.stdout).toContain(root);
    expect(shell.stdout).toContain("hi");
  });

  it("refuses path escape", async () => {
    const root = await folder();
    await expect(listLocalFolder(root, "../")).rejects.toThrow(LOCAL_COMPUTER_PATH_ESCAPE_MESSAGE);
  });
});

describe("LocalSandboxProvider", () => {
  it("forwards files and shell and refuses GUI", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "manor-local-gw-"));
    try {
      await mkdir(path.join(root, "notes"), { recursive: true });
      await writeFile(path.join(root, "notes", "a.txt"), "alpha");
      const gateway = new MemoryLocalComputerGateway();
      gateway.register("sess-1", async (method, params) => {
        const input = params as Record<string, unknown>;
        if (method === "list_files") return listLocalFolder(root, String(input.path ?? ""));
        if (method === "read_file") {
          const bytes = await readLocalFolderFile(root, String(input.path ?? ""));
          return { contentBase64: Buffer.from(bytes).toString("base64") };
        }
        if (method === "write_file") {
          await writeLocalFolderFile(
            root,
            String(input.path ?? ""),
            Buffer.from(String(input.contentBase64 ?? ""), "base64"),
          );
          return { ok: true };
        }
        if (method === "shell") {
          return runLocalFolderShell(root, {
            argv: (input.argv as string[]) ?? [],
            cwd: String(input.cwd ?? ""),
          });
        }
        throw new Error(`unknown ${method}`);
      });
      const sandbox = new LocalSandboxProvider(
        { localComputerSession: { findFirst: async () => ({ id: "sess-1" }) } } as never,
        gateway,
      );
      const computer = await sandbox.provision({ botId: "bot", homePath: root }, ctx);
      expect(computer.kind).toBe("local");
      const files = await sandbox.listFiles(computer, "", ctx);
      expect(files.some((entry) => entry.path.includes("notes"))).toBe(true);
      await sandbox.writeFile(
        computer,
        { path: "notes/scratch.txt", content: new TextEncoder().encode("wrote") },
        ctx,
      );
      expect(await readFile(path.join(root, "notes/scratch.txt"), "utf8")).toBe("wrote");
      let stdout = "";
      for await (const event of sandbox.execute(
        computer,
        { argv: ["bash", "-lc", "printf hi"] },
        ctx,
      )) {
        if (event.type === "stdout") stdout += event.data;
      }
      expect(stdout).toContain("hi");
      await expect(sandbox.act(computer, { actions: [{ kind: "wait", ms: 1 }] })).rejects.toThrow(
        LOCAL_COMPUTER_GUI_MESSAGE,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("createRunSandbox local routing", () => {
  it("does not treat local as SANDBOX_PROVIDER and routes local computers separately", async () => {
    const fake = new FakeSandboxProvider();
    const sandbox = createRunSandbox("fake", { localComputer: fake });
    expect(sandbox.describe().id).toBe("fake");
    const cloud = await sandbox.provision({ botId: "cloud", homePath: "/tmp" }, ctx);
    expect(cloud.kind).toBe("fake");
  });
});
