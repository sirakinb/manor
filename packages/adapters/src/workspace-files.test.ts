import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { AdapterContext, ComputerRef } from "@rakazo/adapter-kit";
import { type WorkspaceFileOperation, WorkspaceFileOperationSchema } from "@rakazo/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DesktopSandboxProvider } from "./desktop-sandbox.js";
import { decodeWorkspaceUpload, manageWorkspaceFiles } from "./workspace-files.js";

const exec = promisify(execFile);
const context: AdapterContext = {
  spaceId: "test-space",
  userId: "test-user",
  botId: "test-bot",
  operationId: "test-files",
  traceId: "test-files",
  signal: new AbortController().signal,
};

describe.skipIf(process.platform === "win32")(
  "workspace files: real offline filesystem and Git",
  () => {
    let root: string;
    let home: string;
    let sandbox: DesktopSandboxProvider;
    let computer: ComputerRef;
    beforeEach(async () => {
      root = await mkdtemp(path.join(tmpdir(), "workspace-files-test-"));
      sandbox = new DesktopSandboxProvider({ root });
      computer = await sandbox.provision({ botId: "test-bot", homePath: "unused" }, context);
      home = computer.providerRef!;
      await mkdir(path.join(home, "bots/test-bot"), { recursive: true });
      await mkdir(path.join(home, "shared"));
    });
    afterEach(async () => {
      await rm(root, { recursive: true, force: true });
    });
    const op = (
      operation: WorkspaceFileOperation,
      base = "bots/test-bot",
      destinationBase?: string,
    ) => manageWorkspaceFiles(sandbox, computer, { base, destinationBase, operation }, context);
    async function revision(file: string) {
      const result = await op({ action: "inspect", path: file });
      if (result.kind !== "revision") throw new Error("Expected revision");
      return result.revision;
    }
    const git = (args: string[]) =>
      exec("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", ...args], {
        cwd: path.join(home, "bots/test-bot"),
        env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
      });

    it("creates persistent nested folders, writes with CAS, moves to shared, searches and deletes", async () => {
      await op({ action: "create", path: "research", kind: "dir" });
      const exported = [];
      for await (const file of sandbox.exportWorkspace(computer)) exported.push(file.path);
      expect(exported).toContain("bots/test-bot/research/.gitkeep");
      await op({ action: "create", path: "research/notes.md", kind: "file" });
      const original = await revision("research/notes.md");
      await op({
        action: "write",
        path: "research/notes.md",
        revision: original,
        content: "# Research\nDone",
      });
      await expect(
        op({
          action: "write",
          path: "research/notes.md",
          revision: original,
          content: "overwrite",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      const content = await op({ action: "read", path: "research/notes.md" });
      expect(content).toMatchObject({
        kind: "file",
        content: "# Research\nDone",
        mimeType: "text/markdown",
      });
      await op(
        {
          action: "move",
          path: "research/notes.md",
          destination: "notes.md",
          destinationLocation: "shared",
          revision: await revision("research/notes.md"),
        },
        "bots/test-bot",
        "shared",
      );
      expect(
        await op({ action: "list", path: "", search: "notes", hidden: false }, "shared"),
      ).toMatchObject({ entries: [{ path: "notes.md" }] });
      await op({ action: "delete", path: "research", revision: await revision("research") });
      expect(await op({ action: "list", path: "", search: "", hidden: false })).toMatchObject({
        entries: [],
      });
    });

    it("refuses overwrites, stale folder deletion and path escapes through links", async () => {
      await op({ action: "create", path: "notes", kind: "dir" });
      const before = await revision("notes");
      await op({
        action: "upload",
        path: "notes/a.txt",
        dataBase64: Buffer.from("keep").toString("base64"),
      });
      await expect(op({ action: "delete", path: "notes", revision: before })).rejects.toMatchObject(
        { code: "CONFLICT" },
      );
      await expect(
        op({ action: "upload", path: "notes/a.txt", dataBase64: "" }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      const outside = path.join(root, "outside");
      await mkdir(outside);
      await writeFile(path.join(outside, "secret.txt"), "private fixture");
      await symlink(outside, path.join(home, "bots/test-bot/link"));
      await expect(op({ action: "read", path: "link/secret.txt" })).rejects.toThrow(/safely/);
      await expect(
        op({ action: "create", path: "link/injected.txt", kind: "file" }),
      ).rejects.toThrow(/safely/);
      await expect(op({ action: "list", path: "link", search: "", hidden: false })).rejects.toThrow(
        /safely/,
      );
      await expect(op({ action: "read", path: "../shared/secret.txt" })).rejects.toThrow(/Invalid/);
      expect(await readFile(path.join(outside, "secret.txt"), "utf8")).toBe("private fixture");
    });

    it("transfers binary files losslessly, bounds previews and hides internal transfer files", async () => {
      const bytes = Buffer.from([0, 255, 127, 128, 10, 13]);
      await op({ action: "upload", path: "data.bin", dataBase64: bytes.toString("base64") });
      expect(await op({ action: "download", path: "data.bin" })).toMatchObject({
        content: null,
        dataBase64: bytes.toString("base64"),
      });
      await writeFile(
        path.join(home, "bots/test-bot/huge.txt"),
        Buffer.alloc(10 * 1024 * 1024 + 1),
      );
      await expect(op({ action: "read", path: "huge.txt" })).rejects.toThrow(/too large/);
      await op(
        {
          action: "move",
          path: "huge.txt",
          destination: "renamed.txt",
          destinationLocation: "bot",
          revision: await revision("huge.txt"),
        },
        "bots/test-bot",
        "bots/test-bot",
      );
      await op({ action: "delete", path: "renamed.txt", revision: await revision("renamed.txt") });
      expect(
        await op({ action: "list", path: "", hidden: true, search: "transfer" }),
      ).toMatchObject({ entries: [] });
    });

    it("supports first-commit diffs, selected commits, branch switching, and shared repository discovery", async () => {
      await op({ action: "git-init", path: "" });
      await op({
        action: "upload",
        path: "a.txt",
        dataBase64: Buffer.from("first\n").toString("base64"),
      });
      await op({
        action: "upload",
        path: "b.txt",
        dataBase64: Buffer.from("other\n").toString("base64"),
      });
      await git(["add", "a.txt"]);
      expect(await op({ action: "git-diff", path: "", file: "a.txt" })).toMatchObject({
        kind: "diff",
        diff: expect.stringContaining("+first"),
      });
      let status = await op({ action: "git-status" });
      if (status.kind !== "git") throw new Error("Expected Git status");
      await op({
        action: "git-commit",
        path: "",
        revision: status.repos[0]!.revision,
        files: ["a.txt"],
        message: "Add first file",
      });
      expect((await git(["ls-tree", "--name-only", "HEAD"])).stdout.trim()).toBe("a.txt");
      status = await op({ action: "git-status" });
      if (status.kind !== "git") throw new Error("Expected Git status");
      await expect(
        op({
          action: "git-branch",
          path: "",
          revision: status.repos[0]!.revision,
          branch: "feature",
          create: true,
        }),
      ).rejects.toThrow(/Commit or resolve/);
      await op({
        action: "git-commit",
        path: "",
        revision: status.repos[0]!.revision,
        files: ["b.txt"],
        message: "Add second file",
      });
      status = await op({ action: "git-status" });
      if (status.kind !== "git") throw new Error("Expected Git status");
      await op({
        action: "git-branch",
        path: "",
        revision: status.repos[0]!.revision,
        branch: "feature",
        create: true,
      });
      expect((await git(["branch", "--show-current"])).stdout.trim()).toBe("feature");
      await op({ action: "git-init", path: "" }, "shared");
      expect(await op({ action: "git-status" }, "shared")).toMatchObject({
        kind: "git",
        repos: [{ path: "", branch: "main" }],
      });
    });

    it("finds nested repositories separately from the containing repository", async () => {
      await op({ action: "git-init", path: "" });
      await op({ action: "create", path: "project", kind: "dir" });
      await op({ action: "git-init", path: "project" });
      const result = await op({ action: "git-status" });
      expect(result).toMatchObject({ kind: "git", repos: [{ path: "" }, { path: "project" }] });
    });

    it("treats pathspec-like filenames literally and never runs commit hooks", async () => {
      await op({ action: "git-init", path: "" });
      await git(["config", "user.name", "Test"]);
      await git(["config", "user.email", "test@example.invalid"]);
      await op({
        action: "upload",
        path: ":(glob)*",
        dataBase64: Buffer.from("literal").toString("base64"),
      });
      await op({
        action: "upload",
        path: "other.txt",
        dataBase64: Buffer.from("other").toString("base64"),
      });
      await writeFile(
        path.join(home, "bots/test-bot/.git/hooks/pre-commit"),
        "#!/bin/sh\ntouch hook-ran\n",
        { mode: 0o755 },
      );
      const status = await op({ action: "git-status" });
      if (status.kind !== "git") throw new Error("Expected Git status");
      await op({
        action: "git-commit",
        path: "",
        revision: status.repos[0]!.revision,
        files: [":(glob)*"],
        message: "Literal selection",
      });
      expect((await git(["ls-tree", "--name-only", "HEAD"])).stdout.trim()).toBe(":(glob)*");
      await expect(readFile(path.join(home, "bots/test-bot/hook-ran"))).rejects.toThrow();
    });

    it("rejects repository filters, external configuration and changed commit contents", async () => {
      await op({ action: "git-init", path: "" });
      await op({ action: "create", path: "a.txt", kind: "file" });
      const status = await op({ action: "git-status" });
      if (status.kind !== "git") throw new Error("Expected Git status");
      await writeFile(path.join(home, "bots/test-bot/a.txt"), "changed");
      await expect(
        op({
          action: "git-commit",
          path: "",
          revision: status.repos[0]!.revision,
          files: ["a.txt"],
          message: "stale",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await git(["config", "filter.test.clean", "touch filter-ran"]);
      await expect(op({ action: "git-status" })).rejects.toThrow(
        /external configuration or filters/,
      );
    });
  },
);

it("validates paths and base64 before accepting uploads", () => {
  for (const value of ["../a", "/etc/a", "a\\b", ".git/config", "a\nfile", "a//b"]) {
    expect(WorkspaceFileOperationSchema.safeParse({ action: "read", path: value }).success).toBe(
      false,
    );
  }
  expect(() => decodeWorkspaceUpload("not base64!")).toThrow(/Invalid/);
  expect(decodeWorkspaceUpload("")).toEqual(Buffer.alloc(0));
  const maximum = Buffer.alloc(10 * 1024 * 1024);
  expect(decodeWorkspaceUpload(maximum.toString("base64")).equals(maximum)).toBe(true);
  expect(() => decodeWorkspaceUpload(Buffer.alloc(maximum.length + 1).toString("base64"))).toThrow(
    /10 MiB/,
  );
});
