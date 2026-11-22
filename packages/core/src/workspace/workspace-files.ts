import type {
  WorkspaceEntry,
  WorkspaceFileOperation,
  WorkspaceFileRequest,
  WorkspaceFileResult,
  WorkspaceLocation,
  WorkspaceRepo,
} from "@rakazo/contracts";

export type WorkspaceOpenFile = Extract<WorkspaceFileResult, { kind: "file" }> & {
  draft: string;
  stale: boolean;
};
export type WorkspaceFilesState = {
  location: WorkspaceLocation;
  directory: string;
  search: string;
  hidden: boolean;
  entries: WorkspaceEntry[];
  truncated: boolean;
  file: WorkspaceOpenFile | null;
  repos: WorkspaceRepo[];
  diff: string | null;
  error: string | null;
  busy: boolean;
  loading: boolean;
};
export type WorkspaceFilesRequest = (request: WorkspaceFileRequest) => Promise<WorkspaceFileResult>;

/** Shared file navigation and draft state for web, Electron and native mobile. No device I/O. */
export class WorkspaceFilesController {
  private listeners = new Set<() => void>();
  private listVersion = 0;
  private fileVersion = 0;
  private gitVersion = 0;
  private diffVersion = 0;
  private state: WorkspaceFilesState = {
    location: "bot",
    directory: "",
    search: "",
    hidden: false,
    entries: [],
    truncated: false,
    file: null,
    repos: [],
    diff: null,
    error: null,
    busy: false,
    loading: false,
  };
  constructor(
    readonly botId: string,
    private request: WorkspaceFilesRequest,
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.state;
  private update(value: Partial<WorkspaceFilesState>) {
    this.state = { ...this.state, ...value };
    for (const listener of this.listeners) listener();
  }
  get dirty() {
    return (
      this.state.file !== null &&
      this.state.file.content !== null &&
      this.state.file.draft !== this.state.file.content
    );
  }
  error = (error: unknown) =>
    this.update({ error: error instanceof Error ? error.message : String(error) });
  clearError = () => this.update({ error: null });
  private call(operation: WorkspaceFileOperation, location = this.state.location) {
    return this.request({ botId: this.botId, location, operation });
  }
  async browse(directory = this.state.directory, location = this.state.location) {
    if (this.state.busy) return;
    ++this.fileVersion;
    ++this.gitVersion;
    ++this.diffVersion;
    this.update({
      directory,
      location,
      file: null,
      diff: null,
      repos: [],
      search: "",
      error: null,
    });
    await this.refresh();
  }
  setSearch(search: string) {
    this.update({ search });
  }
  setHidden(hidden: boolean) {
    this.update({ hidden });
  }
  setDraft(draft: string) {
    if (this.state.file) this.update({ file: { ...this.state.file, draft } });
  }
  revertDraft() {
    if (this.state.file)
      this.update({ file: { ...this.state.file, draft: this.state.file.content ?? "" } });
  }
  async refresh() {
    const version = ++this.listVersion;
    const { directory: path, search, hidden, location } = this.state;
    this.update({ loading: true });
    try {
      const result = await this.call({ action: "list", path, search, hidden }, location);
      if (
        version !== this.listVersion ||
        location !== this.state.location ||
        path !== this.state.directory
      )
        return;
      if (result.kind === "list")
        this.update({ entries: result.entries, truncated: result.truncated });
    } catch (error) {
      if (version === this.listVersion) this.error(error);
    } finally {
      if (version === this.listVersion) this.update({ loading: false });
    }
  }
  async open(path: string) {
    const version = ++this.fileVersion;
    const location = this.state.location;
    this.update({ file: null, error: null });
    try {
      const result = await this.call({ action: "read", path }, location);
      if (version === this.fileVersion && result.kind === "file")
        this.update({ file: { ...result, draft: result.content ?? "", stale: false } });
    } catch (error) {
      if (version === this.fileVersion) this.error(error);
    }
  }
  async checkOpenFile() {
    const file = this.state.file;
    if (!file || this.state.busy || file.content === null) return;
    const version = this.fileVersion;
    try {
      const result = await this.call({ action: "inspect", path: file.path });
      if (version !== this.fileVersion || this.state.busy || result.kind !== "revision") return;
      if (result.revision !== file.revision) {
        if (this.state.file) this.update({ file: { ...this.state.file, stale: true } });
      }
    } catch (error) {
      if (version === this.fileVersion && this.state.file) {
        this.update({ file: { ...this.state.file, stale: true } });
        this.error(error);
      }
    }
  }
  async gitStatus() {
    const version = ++this.gitVersion;
    this.update({ error: null });
    try {
      const result = await this.call({ action: "git-status" });
      if (version === this.gitVersion && result.kind === "git") {
        this.update({ repos: result.repos });
        if (result.truncated)
          this.error(
            "Repository search was limited. Move projects closer to this location's root.",
          );
      }
    } catch (error) {
      if (version === this.gitVersion) this.error(error);
    }
  }
  async showDiff(repo: string, file: string) {
    const version = ++this.diffVersion;
    this.update({ diff: null });
    try {
      const result = await this.call({ action: "git-diff", path: repo, file });
      if (version === this.diffVersion && result.kind === "diff")
        this.update({ diff: result.diff + (result.truncated ? "\n… Diff truncated" : "") });
    } catch (error) {
      if (version === this.diffVersion) this.error(error);
    }
  }
  async download(path: string) {
    const result = await this.call({ action: "download", path });
    if (result.kind !== "file" || result.dataBase64 === undefined)
      throw new Error("Could not download file");
    return result;
  }
  async inspect(path: string) {
    const result = await this.call({ action: "inspect", path });
    if (result.kind !== "revision") throw new Error("Could not inspect file");
    return result.revision;
  }
  async perform(operation: WorkspaceFileOperation): Promise<boolean> {
    if (this.state.busy) return false;
    this.update({ busy: true, error: null });
    try {
      const result = await this.call(operation);
      if (
        operation.action === "write" &&
        result.kind === "revision" &&
        this.state.file?.path === operation.path
      ) {
        this.update({
          file: {
            ...this.state.file,
            revision: result.revision,
            content: operation.content,
            stale: false,
          },
        });
      }
      if (operation.action === "move" || operation.action === "delete") {
        ++this.fileVersion;
        this.update({ file: null });
      }
      await this.refresh();
      if (operation.action.startsWith("git-") || this.state.repos.length) {
        ++this.diffVersion;
        this.update({ diff: null });
        await this.gitStatus();
      }
      return true;
    } catch (error) {
      this.error(error);
      return false;
    } finally {
      this.update({ busy: false });
    }
  }
  save = async () => {
    const file = this.state.file;
    if (!file || !this.dirty || file.stale) return false;
    return this.perform({
      action: "write",
      path: file.path,
      content: file.draft,
      revision: file.revision,
    });
  };
}
