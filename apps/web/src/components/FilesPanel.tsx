import { useLingui } from "@lingui/react/macro";
import { ChatMarkdown } from "@rakazo/chat-ui/web";
import {
  WORKSPACE_FILE_MAX_BYTES,
  type WorkspaceEntry,
  type WorkspaceLocation,
  type WorkspaceRepo,
  workspacePreviewType,
} from "@rakazo/contracts";
import type { WorkspaceFilesController } from "@rakazo/core";
import {
  ChevronRight,
  Download,
  Ellipsis,
  FilePlus2,
  FolderPlus,
  RefreshCw,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { decodeArtifactBase64, downloadArtifactBytes } from "../lib/artifact-open";
import {
  baseName,
  breadcrumbs,
  classifyDiffLine,
  formatBytes,
  joinPath,
  sortEntries,
} from "../lib/files-panel";
import { BuiButton, BuiCard, LoadingState } from "./beautiful-ui/primitives";
import { WorkspacePdfPreview } from "./WorkspacePdfPreview";

type Form = { action: "file" | "dir" | "move" | "delete"; path: string; revision?: string };

export function FilesPanel({
  controller,
  computerState,
  team,
  running,
  onWake,
  onAttach,
}: {
  controller: WorkspaceFilesController;
  computerState: string | undefined;
  team: boolean;
  running: boolean;
  onWake: () => void;
  onAttach: (file: File) => Promise<void>;
}) {
  const { t } = useLingui();
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const [tab, setTab] = useState<"browse" | "changes">("browse");
  const [form, setForm] = useState<Form | null>(null);
  const [destination, setDestination] = useState("");
  const [destinationLocation, setDestinationLocation] = useState<WorkspaceLocation>("bot");
  const [preview, setPreview] = useState(true);
  const uploadInput = useRef<HTMLInputElement>(null);
  const awake = computerState === "running";
  const disabled = state.busy || running || !awake;
  const file = state.file;
  const url = usePreviewUrl(
    file?.mimeType.startsWith("image/") ? file.dataBase64 : undefined,
    file?.mimeType,
  );

  useEffect(() => {
    if (!awake) return;
    const timer = window.setTimeout(() => void controller.refresh(), 200);
    return () => window.clearTimeout(timer);
  }, [awake, controller, state.search, state.hidden]);
  useEffect(() => {
    if (awake && tab === "changes") void controller.gitStatus();
  }, [awake, controller, tab, state.location]);
  useEffect(() => {
    if (!awake) return;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      void controller.checkOpenFile();
      if (!controller.snapshot().busy) void controller.refresh();
    };
    refresh();
    const timer = window.setInterval(refresh, 5000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [awake, controller, running]);

  const canLeave = () =>
    !controller.dirty || window.confirm(t`Discard unsaved edits to this file?`);
  const navigate = (path: string, location = state.location) => {
    if (state.busy || !canLeave()) return;
    setForm(null);
    void controller.browse(path, location);
  };
  const open = (entry: WorkspaceEntry) => {
    if (entry.kind === "dir") {
      navigate(entry.path);
      return;
    }
    if (state.busy || !canLeave()) return;
    setForm(null);
    setPreview(true);
    void controller.open(entry.path);
  };
  async function editEntry(entry: WorkspaceEntry, action: "move" | "delete") {
    if (disabled || !canLeave()) return;
    try {
      const revision = await controller.inspect(entry.path);
      setForm({ action, path: entry.path, revision });
      setDestination(entry.path);
      setDestinationLocation(state.location);
    } catch (error) {
      controller.error(error);
    }
  }
  async function submitForm(event: React.FormEvent) {
    event.preventDefault();
    if (!form || disabled) return;
    let ok = false;
    if (form.action === "file" || form.action === "dir") {
      const path = joinPath(state.directory, destination);
      ok = await controller.perform({ action: "create", path, kind: form.action });
      if (ok && form.action === "file") await controller.open(path);
    } else if (form.revision) {
      ok = await controller.perform(
        form.action === "move"
          ? {
              action: "move",
              path: form.path,
              destination,
              destinationLocation,
              revision: form.revision,
            }
          : { action: "delete", path: form.path, revision: form.revision },
      );
    }
    if (ok) setForm(null);
  }
  async function upload(files: FileList | null) {
    if (!files || disabled) return;
    for (const picked of Array.from(files)) {
      if (picked.size > WORKSPACE_FILE_MAX_BYTES) {
        controller.error(t`Files must be 10 MiB or smaller`);
        break;
      }
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
        reader.onerror = () => reject(new Error(t`Could not read upload`));
        reader.readAsDataURL(picked);
      });
      if (
        !(await controller.perform({
          action: "upload",
          path: joinPath(state.directory, picked.name),
          dataBase64,
        }))
      )
        break;
    }
    if (uploadInput.current) uploadInput.current.value = "";
  }
  async function download(path: string, attach = false) {
    try {
      const result = await controller.download(path);
      const bytes = decodeArtifactBase64(result.dataBase64!);
      if (attach)
        await onAttach(
          new File([new Uint8Array(bytes)], baseName(path), { type: result.mimeType }),
        );
      else downloadArtifactBytes(baseName(path), result.mimeType, bytes);
    } catch (error) {
      controller.error(error);
    }
  }

  return (
    <div
      data-testid="files-panel"
      className="flex h-full min-h-0 flex-col gap-3 text-[13px] text-[#DFDFE2]"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="tablist"
          aria-label={t`Files view`}
          className="flex rounded-full border border-[#26262A] p-0.5"
        >
          {(["browse", "changes"] as const).map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={tab === item}
              data-testid={`files-tab-${item}`}
              onClick={() => setTab(item)}
              className={`rounded-full px-3 py-1.5 ${tab === item ? "bg-[#26262A]" : "text-[#85858A]"}`}
            >
              {item === "browse" ? t`Browse` : t`Changes`}
            </button>
          ))}
        </div>
        <select
          aria-label={t`File location`}
          value={state.location}
          disabled={state.busy}
          onChange={(event) => navigate("", event.target.value as WorkspaceLocation)}
          className="min-w-0 rounded-lg bg-[#17171A] p-2"
        >
          <option value="bot">{t`Bot files`}</option>
          {team ? <option value="shared">{t`Shared files`}</option> : null}
        </select>
        <button
          type="button"
          aria-label={t`Refresh files`}
          disabled={state.busy || !awake}
          onClick={() => {
            controller.clearError();
            void controller.refresh();
            void controller.checkOpenFile();
            if (tab === "changes") void controller.gitStatus();
          }}
          className="ms-auto p-2"
        >
          <RefreshCw size={15} className={state.loading ? "animate-spin" : ""} />
        </button>
      </div>
      {state.error ? (
        <div role="alert" className="rounded-lg border border-[#613337] p-3 text-[#FCA5A5]">
          {state.error}
        </div>
      ) : null}
      {!awake ? (
        <BuiCard className="p-4">
          <p className="mb-3">{t`Wake the computer to manage its files.`}</p>
          <BuiButton onClick={onWake}>{t`Wake computer`}</BuiButton>
        </BuiCard>
      ) : (
        <>
          {running ? (
            <p className="text-[#C4B5FD]">{t`The bot is working. Editing is paused.`}</p>
          ) : null}
          {tab === "browse" ? (
            <>
              <nav aria-label={t`Folder path`} className="flex flex-wrap items-center gap-1">
                {breadcrumbs(
                  state.directory,
                  state.location === "shared" ? t`Shared files` : t`Bot files`,
                ).map((crumb, index) => (
                  <span key={crumb.path} className="flex items-center gap-1">
                    {index ? <ChevronRight size={12} /> : null}
                    <button
                      type="button"
                      disabled={state.busy}
                      onClick={() => navigate(crumb.path)}
                      className="max-w-[220px] truncate text-[#A8A8AD]"
                    >
                      {crumb.label}
                    </button>
                  </span>
                ))}
              </nav>
              <div className="flex flex-wrap gap-1.5">
                <BuiButton
                  disabled={disabled}
                  onClick={() => {
                    if (canLeave()) {
                      setForm({ action: "file", path: "" });
                      setDestination("");
                    }
                  }}
                >
                  <span className="flex items-center gap-1.5">
                    <FilePlus2 size={14} />
                    {t`New file`}
                  </span>
                </BuiButton>
                <BuiButton
                  disabled={disabled}
                  onClick={() => {
                    if (canLeave()) {
                      setForm({ action: "dir", path: "" });
                      setDestination("");
                    }
                  }}
                >
                  <span className="flex items-center gap-1.5">
                    <FolderPlus size={14} />
                    {t`New folder`}
                  </span>
                </BuiButton>
                <BuiButton disabled={disabled} onClick={() => uploadInput.current?.click()}>
                  <span className="flex items-center gap-1.5">
                    <Upload size={14} />
                    {t`Upload`}
                  </span>
                </BuiButton>
                <input
                  ref={uploadInput}
                  type="file"
                  multiple
                  aria-label={t`Upload files`}
                  className="hidden"
                  onChange={(event) => void upload(event.target.files).catch(controller.error)}
                />
              </div>
              {form ? (
                <BuiCard className="p-3">
                  <form
                    onSubmit={(event) => void submitForm(event)}
                    className="flex flex-col gap-3"
                  >
                    <div className="break-all font-medium">
                      {form.action === "file"
                        ? t`New file`
                        : form.action === "dir"
                          ? t`New folder`
                          : form.action === "move"
                            ? t`Rename or move ${form.path}`
                            : t`Delete ${form.path}?`}
                    </div>
                    {form.action === "delete" ? (
                      <p className="text-[#A8A8AD]">{t`This removes the item and everything inside it from the computer.`}</p>
                    ) : (
                      <>
                        {form.action === "move" && team ? (
                          <select
                            aria-label={t`Destination location`}
                            value={destinationLocation}
                            onChange={(event) =>
                              setDestinationLocation(event.target.value as WorkspaceLocation)
                            }
                            className="rounded-lg bg-[#222226] p-2"
                          >
                            <option value="bot">{t`Bot files`}</option>
                            <option value="shared">{t`Shared files`}</option>
                          </select>
                        ) : null}
                        <input
                          aria-label={form.action === "move" ? t`Destination path` : t`Name`}
                          placeholder={
                            form.action === "move" ? t`Path from the selected location` : t`Name`
                          }
                          value={destination}
                          onChange={(event) => setDestination(event.target.value)}
                          required
                          className="rounded-lg border border-[#343438] bg-[#0E0E10] p-2"
                        />
                      </>
                    )}
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        disabled={disabled}
                        className="rounded-full bg-[#DFDFE2] px-4 py-2 text-[#17171A] disabled:opacity-40"
                      >
                        {form.action === "delete" ? t`Delete` : t`Save`}
                      </button>
                      <BuiButton
                        disabled={state.busy}
                        onClick={() => setForm(null)}
                      >{t`Cancel`}</BuiButton>
                    </div>
                  </form>
                </BuiCard>
              ) : null}
              <div className="flex items-center gap-2">
                <input
                  aria-label={t`Search files`}
                  placeholder={t`Search files in this folder`}
                  value={state.search}
                  onChange={(event) => controller.setSearch(event.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-[#26262A] bg-[#131315] px-3 py-2"
                />
                <label className="flex items-center gap-1.5 text-xs text-[#A8A8AD]">
                  <input
                    type="checkbox"
                    checked={state.hidden}
                    onChange={(event) => controller.setHidden(event.target.checked)}
                  />
                  {t`Hidden`}
                </label>
              </div>
              <BuiCard
                data-testid="files-list"
                className="rk-scroll max-h-[32vh] min-h-[90px] overflow-y-auto border border-[#26262A]"
              >
                {state.loading && !state.entries.length ? (
                  <div className="p-3">
                    <LoadingState label={t`Loading files`} />
                  </div>
                ) : !state.entries.length ? (
                  <p className="p-3 text-[#85858A]">
                    {state.search ? t`No matching files` : t`Empty folder`}
                  </p>
                ) : (
                  sortEntries(state.entries).map((entry) => (
                    <div
                      key={entry.path}
                      className={`flex items-center gap-1 border-b border-[#202023] last:border-0 ${file?.path === entry.path ? "bg-[#232326]" : ""}`}
                    >
                      <button
                        type="button"
                        onClick={() => open(entry)}
                        aria-label={entry.path}
                        disabled={state.busy}
                        className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-start hover:bg-[#202023]"
                      >
                        <span className="w-3 text-[#85858A]">
                          {entry.kind === "dir" ? "▸" : ""}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-mono text-xs">
                          {state.search ? entry.path : baseName(entry.path)}
                          {entry.kind === "dir" ? "/" : ""}
                        </span>
                        {entry.kind === "file" ? (
                          <span className="text-[11px] text-[#85858A]">
                            {formatBytes(entry.size)}
                          </span>
                        ) : null}
                      </button>
                      {entry.kind === "file" ? (
                        <button
                          type="button"
                          aria-label={t`Download ${entry.path}`}
                          onClick={() => void download(entry.path)}
                          className="p-2 text-[#A8A8AD]"
                        >
                          <Download size={14} />
                        </button>
                      ) : null}
                      <details className="relative">
                        <summary
                          aria-label={t`Actions for ${entry.path}`}
                          className="cursor-pointer list-none p-2"
                        >
                          <Ellipsis size={16} />
                        </summary>
                        <div className="absolute end-0 z-10 min-w-[150px] rounded-lg border border-[#343438] bg-[#17171A] p-1 shadow-xl">
                          <button
                            type="button"
                            disabled={disabled}
                            onClick={(event) => {
                              event.currentTarget.closest("details")?.removeAttribute("open");
                              void editEntry(entry, "move");
                            }}
                            className="w-full px-3 py-2 text-start disabled:opacity-40"
                          >{t`Rename / Move`}</button>
                          <button
                            type="button"
                            disabled={disabled}
                            onClick={(event) => {
                              event.currentTarget.closest("details")?.removeAttribute("open");
                              void editEntry(entry, "delete");
                            }}
                            className="w-full px-3 py-2 text-start text-[#FCA5A5] disabled:opacity-40"
                          >{t`Delete`}</button>
                        </div>
                      </details>
                    </div>
                  ))
                )}
              </BuiCard>
              {state.truncated ? (
                <p className="text-xs text-[#A8A8AD]">{t`Some results are hidden. Open a smaller folder or refine your search.`}</p>
              ) : null}
              {file ? (
                <BuiCard
                  data-testid="files-editor"
                  className="flex min-h-0 flex-1 flex-col overflow-hidden border border-[#26262A]"
                >
                  <div className="flex flex-wrap items-center gap-2 border-b border-[#26262A] px-3 py-2">
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">
                      {file.path}
                      {controller.dirty ? " •" : ""}
                    </span>
                    <button
                      type="button"
                      disabled={controller.dirty || state.busy}
                      onClick={() => void download(file.path, true)}
                      className="text-xs disabled:opacity-40"
                    >{t`Attach to chat`}</button>
                    {file.content !== null ? (
                      <>
                        {workspacePreviewType(file.path) === "markdown" ? (
                          <button
                            type="button"
                            onClick={() => setPreview(!preview)}
                            className="text-xs"
                          >
                            {preview ? t`Edit` : t`Preview`}
                          </button>
                        ) : null}
                        {controller.dirty ? (
                          <button
                            type="button"
                            disabled={state.busy}
                            onClick={() => {
                              if (window.confirm(t`Discard unsaved edits?`))
                                controller.revertDraft();
                            }}
                            className="text-xs text-[#A8A8AD]"
                          >{t`Discard edits`}</button>
                        ) : null}
                        <button
                          type="button"
                          data-testid="files-save"
                          disabled={disabled || !controller.dirty || file.stale}
                          onClick={() => void controller.save()}
                          className="rounded-full bg-[#DFDFE2] px-3 py-1 text-xs text-[#17171A] disabled:opacity-40"
                        >
                          {state.busy ? t`Saving…` : t`Save`}
                        </button>
                      </>
                    ) : null}
                  </div>
                  {file.stale ? (
                    <div
                      role="alert"
                      className="flex flex-wrap items-center gap-2 border-b border-[#613337] p-3 text-[#FCA5A5]"
                    >
                      <span>{t`This file changed on the computer. Your edits are still here.`}</span>
                      <button
                        type="button"
                        onClick={() => {
                          if (canLeave()) void controller.open(file.path);
                        }}
                        className="underline"
                      >{t`Reload file`}</button>
                      {controller.dirty ? (
                        <button
                          type="button"
                          onClick={() =>
                            downloadArtifactBytes(
                              `${baseName(file.path)}.draft.txt`,
                              "text/plain",
                              new TextEncoder().encode(file.draft),
                            )
                          }
                          className="underline"
                        >{t`Download my draft`}</button>
                      ) : null}
                    </div>
                  ) : null}
                  {file.mimeType.startsWith("image/") && url ? (
                    <img
                      src={url}
                      alt={baseName(file.path)}
                      className="max-h-[45vh] object-contain p-3"
                    />
                  ) : file.mimeType === "application/pdf" && file.dataBase64 ? (
                    <WorkspacePdfPreview key={file.revision} dataBase64={file.dataBase64} />
                  ) : file.content !== null ? (
                    preview && workspacePreviewType(file.path) === "markdown" ? (
                      <div className="rk-scroll min-h-[180px] overflow-auto p-4">
                        <ChatMarkdown>{file.draft}</ChatMarkdown>
                      </div>
                    ) : (
                      <textarea
                        aria-label={t`File content`}
                        value={file.draft}
                        readOnly={disabled}
                        spellCheck={false}
                        onChange={(event) => controller.setDraft(event.target.value)}
                        className="rk-scroll min-h-[240px] flex-1 resize-none bg-[#0E0E10] p-3 font-mono text-xs leading-relaxed outline-none"
                      />
                    )
                  ) : (
                    <div className="p-4 text-[#A8A8AD]">{t`Preview unavailable. Download this file to open it.`}</div>
                  )}
                </BuiCard>
              ) : null}
            </>
          ) : (
            <GitFiles controller={controller} disabled={disabled} />
          )}
        </>
      )}
    </div>
  );
}

function GitFiles({
  controller,
  disabled,
}: {
  controller: WorkspaceFilesController;
  disabled: boolean;
}) {
  const { t } = useLingui();
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const [repoPath, setRepoPath] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [branch, setBranch] = useState("");
  const [createBranch, setCreateBranch] = useState(false);
  const repo: WorkspaceRepo | undefined =
    state.repos.find((item) => item.path === repoPath) ?? state.repos[0];
  useEffect(() => {
    setSelected([]);
    setBranch("");
  }, [repo?.revision, repo?.path, state.location]);
  async function commit() {
    if (!repo) return;
    if (
      await controller.perform({
        action: "git-commit",
        path: repo.path,
        revision: repo.revision,
        files: selected,
        message,
      })
    )
      setMessage("");
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {!repo ? (
        <BuiCard className="p-4">
          <p className="mb-3 text-[#A8A8AD]">{t`No Git repositories in this location.`}</p>
          <BuiButton
            disabled={disabled}
            onClick={() => {
              if (window.confirm(t`Enable Git in the current folder? Files stay on this computer.`))
                void controller.perform({ action: "git-init", path: state.directory });
            }}
          >{t`Enable Git in this folder`}</BuiButton>
        </BuiCard>
      ) : (
        <>
          <select
            aria-label={t`Repository`}
            value={repo.path}
            onChange={(event) => setRepoPath(event.target.value)}
            className="rounded-lg bg-[#17171A] p-2"
          >
            {state.repos.map((item) => (
              <option key={item.path} value={item.path}>
                {item.path || (state.location === "shared" ? t`Shared files` : t`Bot files`)} ·{" "}
                {item.branch}
              </option>
            ))}
          </select>
          <details className="rounded-lg border border-[#26262A] p-3">
            <summary className="cursor-pointer">
              {t`Branch`}: {repo.branch}
            </summary>
            <div className="mt-3 flex flex-col gap-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={createBranch}
                  onChange={(event) => {
                    setCreateBranch(event.target.checked);
                    setBranch("");
                  }}
                />
                {t`New branch`}
              </label>
              {createBranch ? (
                <input
                  aria-label={t`Branch name`}
                  value={branch}
                  onChange={(event) => setBranch(event.target.value)}
                  className="rounded-lg bg-[#222226] p-2"
                />
              ) : (
                <select
                  aria-label={t`Switch branch`}
                  value={branch}
                  onChange={(event) => setBranch(event.target.value)}
                  className="rounded-lg bg-[#222226] p-2"
                >
                  <option value="">{t`Choose branch`}</option>
                  {repo.branches
                    .filter((item) => item !== repo.branch)
                    .map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                </select>
              )}
              <BuiButton
                disabled={disabled || !branch || repo.files.length > 0}
                onClick={() =>
                  void controller.perform({
                    action: "git-branch",
                    path: repo.path,
                    revision: repo.revision,
                    branch,
                    create: createBranch,
                  })
                }
              >
                {createBranch ? t`Create branch` : t`Switch branch`}
              </BuiButton>
              {repo.files.length ? (
                <p className="text-xs text-[#A8A8AD]">{t`Commit changes before switching branches.`}</p>
              ) : null}
            </div>
          </details>
          <BuiCard
            data-testid="files-changes"
            className="rk-scroll max-h-[30vh] overflow-y-auto border border-[#26262A]"
          >
            {!repo.files.length ? (
              <p className="p-3 text-[#A8A8AD]">{t`Working tree clean`}</p>
            ) : (
              repo.files.map((change) => (
                <div key={change.path} className="flex items-center gap-2 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label={t`Include ${change.path} in commit`}
                    checked={selected.includes(change.path)}
                    disabled={disabled}
                    onChange={(event) =>
                      setSelected(
                        event.target.checked
                          ? [...selected, change.path]
                          : selected.filter((path) => path !== change.path),
                      )
                    }
                  />
                  <span className="w-4 text-xs text-[#A8A8AD]" title={change.status}>
                    {change.status === "untracked" ? "U" : change.status[0]?.toUpperCase()}
                  </span>
                  <button
                    type="button"
                    onClick={() => void controller.showDiff(repo.path, change.path)}
                    className="min-w-0 flex-1 truncate text-start font-mono text-xs"
                  >
                    {change.path}
                  </button>
                </div>
              ))
            )}
          </BuiCard>
          {repo.files.length ? (
            <div className="flex flex-col gap-2">
              <input
                aria-label={t`Commit message`}
                placeholder={t`Commit message`}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                className="rounded-lg border border-[#26262A] bg-[#131315] p-2"
              />
              <BuiButton
                disabled={disabled || !message.trim() || !selected.length}
                onClick={() => void commit()}
              >{t`Commit selected files`}</BuiButton>
            </div>
          ) : null}
          {state.diff !== null ? (
            <pre
              data-testid="files-diff"
              className="rk-scroll min-h-[160px] flex-1 overflow-auto rounded-lg bg-[#0E0E10] p-3 text-xs leading-relaxed"
            >
              {state.diff.split("\n").map((line, index) => (
                <div
                  key={index}
                  style={{
                    color: {
                      add: "#4ECB71",
                      del: "#F87171",
                      hunk: "#C4B5FD",
                      meta: "#85858A",
                      context: "#DFDFE2",
                    }[classifyDiffLine(line)],
                  }}
                >
                  {line || " "}
                </div>
              ))}
            </pre>
          ) : null}
        </>
      )}
    </div>
  );
}

function usePreviewUrl(dataBase64?: string, mimeType?: string) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (dataBase64 === undefined) {
      setUrl(undefined);
      return;
    }
    const next = URL.createObjectURL(
      new Blob([new Uint8Array(decodeArtifactBase64(dataBase64))], { type: mimeType }),
    );
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [dataBase64, mimeType]);
  return url;
}
