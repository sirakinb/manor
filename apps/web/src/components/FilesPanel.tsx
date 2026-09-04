import { useLingui } from "@lingui/react/macro";
import type { WorkspaceChangeStatus } from "@rakazo/contracts";
import { ChevronRight, FolderTree, GitBranch, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  baseName,
  breadcrumbs,
  classifyDiffLine,
  type FileEntry,
  formatBytes,
  joinPath,
  looksBinary,
  sortEntries,
} from "../lib/files-panel";
import { rpc } from "../lib/rpc";

type Tab = "browse" | "changes";

type OpenFile = {
  path: string;
  content: string;
  draft: string;
  readOnly: string | null;
};

type Changes = Awaited<ReturnType<typeof rpc.computer.changes>>;

const STATUS_GLYPH: Record<WorkspaceChangeStatus, { glyph: string; color: string }> = {
  added: { glyph: "A", color: "#4ECB71" },
  untracked: { glyph: "U", color: "#4ECB71" },
  modified: { glyph: "M", color: "#F5A03C" },
  renamed: { glyph: "R", color: "#8B5CF6" },
  deleted: { glyph: "D", color: "#EF4444" },
  conflict: { glyph: "!", color: "#EF4444" },
};

const DIFF_COLORS: Record<ReturnType<typeof classifyDiffLine>, string> = {
  add: "#4ECB71",
  del: "#F87171",
  hunk: "#8B5CF6",
  meta: "#6C6C70",
  context: "#A8A8AD",
};

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * A window into the bot's computer: browse and edit the workspace, and see the
 * uncommitted work in every git repository inside it. Editing pauses while a
 * run is active so the user and the bot never write the same file at once.
 */
export function FilesPanel({
  botId,
  computerState,
  running,
  onWake,
}: {
  botId: string;
  computerState: string | undefined;
  running: boolean;
  onWake: () => void;
}) {
  const { t } = useLingui();
  const [tab, setTab] = useState<Tab>("browse");
  const [dir, setDir] = useState("");
  const [entries, setEntries] = useState<FileEntry[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [file, setFile] = useState<OpenFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [changes, setChanges] = useState<Changes | null>(null);
  const [changesError, setChangesError] = useState<string | null>(null);
  const [diff, setDiff] = useState<{
    repo: string;
    path: string;
    diff: string;
    truncated: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const wasRunning = useRef(running);
  const dirty = file !== null && file.draft !== file.content;

  const loadDir = useCallback(
    async (target: string) => {
      setListError(null);
      try {
        const listed = await rpc.computer.files({ botId, path: target });
        setEntries(sortEntries(listed));
      } catch (error) {
        setEntries([]);
        setListError(errorText(error, t`Could not list files`));
      }
    },
    [botId, t],
  );

  const openFile = useCallback(
    async (path: string) => {
      setFileError(null);
      if (looksBinary(path)) {
        setFile({
          path,
          content: "",
          draft: "",
          readOnly: t`Binary file. Preview is not available.`,
        });
        return;
      }
      try {
        const loaded = await rpc.computer.readFile({ botId, path });
        setFile({ path, content: loaded.content, draft: loaded.content, readOnly: null });
      } catch (error) {
        setFile({
          path,
          content: "",
          draft: "",
          readOnly: errorText(error, t`This file cannot be shown.`),
        });
      }
    },
    [botId, t],
  );

  const loadChanges = useCallback(async () => {
    setChangesError(null);
    try {
      setChanges(await rpc.computer.changes({ botId }));
    } catch (error) {
      setChanges(null);
      setChangesError(errorText(error, t`Could not read changes`));
    }
  }, [botId, t]);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      await loadDir(dir);
      if (file && !dirty && !file.readOnly) await openFile(file.path);
      if (tab === "changes") await loadChanges();
    } finally {
      setBusy(false);
    }
  }, [dir, dirty, file, loadChanges, loadDir, openFile, tab]);

  useEffect(() => {
    setDir("");
    setEntries(null);
    setFile(null);
    setChanges(null);
    setDiff(null);
  }, [botId]);

  useEffect(() => {
    void loadDir(dir);
  }, [dir, loadDir]);

  useEffect(() => {
    if (tab === "changes" && changes === null) void loadChanges();
  }, [changes, loadChanges, tab]);

  // A run just finished: the bot may have touched anything, so re-read.
  useEffect(() => {
    if (wasRunning.current && !running) void refresh();
    wasRunning.current = running;
  }, [refresh, running]);

  const save = async () => {
    if (!file || !dirty) return;
    setSaving(true);
    setFileError(null);
    try {
      await rpc.computer.writeFile({ botId, path: file.path, content: file.draft });
      setFile({ ...file, content: file.draft });
      void loadDir(dir);
    } catch (error) {
      setFileError(errorText(error, t`Could not save`));
    } finally {
      setSaving(false);
    }
  };

  const showDiff = async (repo: string, path: string) => {
    setDiff({ repo, path, diff: "", truncated: false });
    try {
      const result = await rpc.computer.diff({ botId, repo, path });
      setDiff({ repo, path, ...result });
    } catch (error) {
      setDiff({ repo, path, diff: errorText(error, t`Could not load diff`), truncated: false });
    }
  };

  const crumbs = breadcrumbs(dir, t`Home`);
  const asleep = computerState !== "running";

  return (
    <div data-testid="files-panel" className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex gap-1 rounded-full border border-[#202023] bg-[#131315] p-0.5">
          {(["browse", "changes"] as const).map((item) => (
            <button
              key={item}
              type="button"
              data-testid={`files-tab-${item}`}
              onClick={() => setTab(item)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-medium ${
                tab === item ? "bg-[#26262A] text-[#ECECEE]" : "text-[#85858A] hover:text-[#C9C9CE]"
              }`}
            >
              {item === "browse" ? (
                <FolderTree size={13} strokeWidth={1.8} />
              ) : (
                <GitBranch size={13} strokeWidth={1.8} />
              )}
              {item === "browse" ? t`Browse` : t`Changes`}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-label={t`Refresh files`}
          disabled={busy}
          onClick={() => void refresh()}
          className="text-[#85858A] hover:text-[#ECECEE] disabled:opacity-40"
        >
          <RefreshCw size={15} strokeWidth={1.7} className={busy ? "animate-spin" : undefined} />
        </button>
      </div>

      {running ? (
        <div className="rounded-[12px] border border-[#2A2140] bg-[#1A1526] px-3 py-2 text-[12.5px] text-[#C4B5FD]">
          {t`The bot is working. Files refresh when it finishes; editing is paused until then.`}
        </div>
      ) : null}

      {tab === "browse" ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <nav
            aria-label={t`Folder path`}
            className="flex flex-wrap items-center gap-0.5 text-[12.5px]"
          >
            {crumbs.map((crumb, index) => (
              <span key={crumb.path} className="flex items-center gap-0.5">
                {index > 0 ? <ChevronRight size={12} className="text-[#4A4A50]" /> : null}
                <button
                  type="button"
                  onClick={() => {
                    setDir(crumb.path);
                    setFile(null);
                  }}
                  className={
                    index === crumbs.length - 1
                      ? "text-[#ECECEE]"
                      : "text-[#85858A] hover:text-[#ECECEE]"
                  }
                >
                  {crumb.label}
                </button>
              </span>
            ))}
          </nav>

          <div
            data-testid="files-list"
            className="rk-scroll max-h-[38vh] min-h-[120px] overflow-y-auto rounded-[14px] border border-[#202023] bg-[#131315]"
          >
            {listError ? (
              <div className="px-3 py-3 text-[12.5px] text-[#F87171]">{listError}</div>
            ) : entries === null ? (
              <div className="px-3 py-3 text-[12.5px] text-[#6C6C70]">{t`Loading…`}</div>
            ) : entries.length === 0 ? (
              <div className="px-3 py-3 text-[12.5px] text-[#6C6C70]">{t`Empty folder`}</div>
            ) : (
              entries.map((entry) => {
                const name = baseName(entry.path);
                const full = joinPath(dir, name);
                const selected = file?.path === full;
                return (
                  <button
                    key={entry.path}
                    type="button"
                    onClick={() => {
                      if (entry.kind === "dir") {
                        setDir(full);
                        setFile(null);
                      } else {
                        void openFile(full);
                      }
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-[7px] text-start text-[13px] hover:bg-[#1B1B1E] ${
                      selected ? "bg-[#1B1B1E] text-[#ECECEE]" : "text-[#C9C9CE]"
                    }`}
                  >
                    <span className="w-3 shrink-0 text-[#6C6C70]">
                      {entry.kind === "dir" ? "▸" : ""}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]" dir="ltr">
                      {name}
                      {entry.kind === "dir" ? "/" : ""}
                    </span>
                    {entry.kind === "file" ? (
                      <span className="shrink-0 text-[11.5px] text-[#6C6C70]">
                        {formatBytes(entry.size)}
                      </span>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>

          {file ? (
            <div
              data-testid="files-editor"
              className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-[#202023] bg-[#0E0E10]"
            >
              <div className="flex items-center justify-between gap-2 border-b border-[#1B1B1E] px-3 py-2">
                <span className="min-w-0 truncate font-mono text-[12px] text-[#C9C9CE]" dir="ltr">
                  {file.path}
                  {dirty ? <span className="text-[#F5A03C]"> •</span> : null}
                </span>
                <div className="flex shrink-0 items-center gap-2">
                  {dirty ? (
                    <button
                      type="button"
                      onClick={() => setFile({ ...file, draft: file.content })}
                      className="text-[12px] text-[#85858A] hover:text-[#ECECEE]"
                    >
                      {t`Revert`}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    data-testid="files-save"
                    disabled={!dirty || saving || running || file.readOnly !== null}
                    onClick={() => void save()}
                    className="rounded-full bg-[#8B5CF6] px-3 py-1 text-[12px] font-medium text-white disabled:opacity-40"
                  >
                    {saving ? t`Saving…` : t`Save`}
                  </button>
                </div>
              </div>
              {fileError ? (
                <div className="border-b border-[#1B1B1E] px-3 py-2 text-[12px] text-[#F87171]">
                  {fileError}
                </div>
              ) : null}
              {file.readOnly ? (
                <div className="px-3 py-4 text-[12.5px] text-[#6C6C70]">{file.readOnly}</div>
              ) : (
                <textarea
                  value={file.draft}
                  readOnly={running}
                  spellCheck={false}
                  onChange={(event) => setFile({ ...file, draft: event.target.value })}
                  className="rk-scroll min-h-[260px] flex-1 resize-none bg-transparent px-3 py-2 font-mono text-[12.5px] leading-[1.55] text-[#DFDFE2] outline-none"
                  dir="ltr"
                />
              )}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {asleep ? (
            <div className="rounded-[14px] border border-[#202023] bg-[#131315] px-3 py-4 text-center text-[12.5px] text-[#85858A]">
              <div>{t`The computer is asleep. Wake it to see uncommitted changes.`}</div>
              <button
                type="button"
                onClick={onWake}
                className="mt-3 rounded-full border border-[#26262A] px-3 py-1 text-[12px] text-[#ECECEE] hover:bg-[#1B1B1E]"
              >
                {t`Wake computer`}
              </button>
            </div>
          ) : changesError ? (
            <div className="text-[12.5px] text-[#F87171]">{changesError}</div>
          ) : changes === null ? (
            <div className="text-[12.5px] text-[#6C6C70]">{t`Looking for repositories…`}</div>
          ) : changes.repos.length === 0 ? (
            <div className="rounded-[14px] border border-[#202023] bg-[#131315] px-3 py-4 text-[12.5px] text-[#85858A]">
              {t`No git repositories in this workspace yet. Changes appear here once the bot works inside one.`}
            </div>
          ) : (
            <div
              data-testid="files-changes"
              className="rk-scroll max-h-[38vh] overflow-y-auto rounded-[14px] border border-[#202023] bg-[#131315]"
            >
              {changes.repos.map((repo) => (
                <div key={repo.path || "."}>
                  <div className="flex items-center gap-2 border-b border-[#1B1B1E] px-3 py-2 font-mono text-[12px] text-[#85858A]">
                    <GitBranch size={12} strokeWidth={1.8} />
                    <span className="truncate" dir="ltr">
                      {repo.path || t`workspace root`}
                    </span>
                    <span className="ms-auto text-[11.5px]">
                      {repo.files.length === 0
                        ? t`clean`
                        : repo.files.length === 1
                          ? t`1 file`
                          : t`${repo.files.length} files`}
                    </span>
                  </div>
                  {repo.files.map((change) => {
                    const glyph = STATUS_GLYPH[change.status];
                    const selected = diff?.repo === repo.path && diff.path === change.path;
                    return (
                      <button
                        key={change.path}
                        type="button"
                        onClick={() => void showDiff(repo.path, change.path)}
                        className={`flex w-full items-center gap-2 px-3 py-[6px] text-start hover:bg-[#1B1B1E] ${
                          selected ? "bg-[#1B1B1E]" : ""
                        }`}
                      >
                        <span
                          className="w-3 shrink-0 text-center font-mono text-[11.5px] font-semibold"
                          style={{ color: glyph.color }}
                          title={change.status}
                        >
                          {glyph.glyph}
                        </span>
                        <span
                          className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-[#C9C9CE]"
                          dir="ltr"
                        >
                          {change.path}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}

          {diff ? (
            <div
              data-testid="files-diff"
              className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-[#202023] bg-[#0E0E10]"
            >
              <div
                className="truncate border-b border-[#1B1B1E] px-3 py-2 font-mono text-[12px] text-[#C9C9CE]"
                dir="ltr"
              >
                {diff.path}
              </div>
              <pre
                className="rk-scroll min-h-[200px] flex-1 overflow-auto px-3 py-2 font-mono text-[12px] leading-[1.5]"
                dir="ltr"
              >
                {diff.diff ? (
                  diff.diff.split("\n").map((line, index) => (
                    <div key={index} style={{ color: DIFF_COLORS[classifyDiffLine(line)] }}>
                      {line || " "}
                    </div>
                  ))
                ) : (
                  <span className="text-[#6C6C70]">{t`Loading…`}</span>
                )}
                {diff.truncated ? (
                  <div className="mt-2 text-[#6C6C70]">{t`Diff truncated.`}</div>
                ) : null}
              </pre>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
