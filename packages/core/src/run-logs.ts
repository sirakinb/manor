import type { Run, RunDiagnostics } from "@rakazo/contracts";

export interface RunLogsTransport {
  history(input: { botId: string }): Promise<{ runs: Run[] }>;
  diagnostics(input: { runId: string; before?: number }): Promise<RunDiagnostics>;
}
export interface RunLogsState {
  runs: Run[];
  selectedId: string | null;
  data: RunDiagnostics | null;
  loading: boolean;
  loadingOlder: boolean;
  error: string | null;
}

/** Shared web/native polling, selection and pagination; no prompts or tool arguments. */
export class RunLogsController {
  private state: RunLogsState = {
    runs: [],
    selectedId: null,
    data: null,
    loading: true,
    loadingOlder: false,
    error: null,
  };
  private listeners = new Set<() => void>();
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private active = false;
  constructor(
    private botId: string,
    private transport: RunLogsTransport,
  ) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<RunLogsState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  start() {
    this.active = true;
    void this.refresh();
  }
  stop() {
    this.active = false;
    this.generation++;
    clearTimeout(this.timer);
  }
  select(runId: string) {
    this.generation++;
    this.update({ selectedId: runId, data: null, loading: true, loadingOlder: false, error: null });
    void this.refresh();
  }
  refresh = async () => {
    clearTimeout(this.timer);
    const generation = ++this.generation;
    this.update({ loadingOlder: false });
    try {
      const { runs } = await this.transport.history({ botId: this.botId });
      if (generation !== this.generation) return;
      const selectedId = this.state.selectedId ?? runs[0]?.id ?? null;
      const data = selectedId ? await this.transport.diagnostics({ runId: selectedId }) : null;
      if (generation !== this.generation) return;
      const previous = this.state.data;
      if (
        data &&
        previous?.run.id === data.run.id &&
        previous.events[0] &&
        data.events[0] &&
        previous.events[0].seq < data.events[0].seq
      ) {
        data.events = [
          ...new Map(
            [...previous.events, ...data.events].map((event) => [event.id, event]),
          ).values(),
        ].sort((a, b) => a.seq - b.seq);
        data.olderCursor = previous.olderCursor;
      }
      const visibleRuns =
        data && !runs.some((run) => run.id === data.run.id) ? [...runs, data.run] : runs;
      this.update({ runs: visibleRuns, selectedId, data, loading: false, error: null });
    } catch {
      if (generation === this.generation)
        this.update({ loading: false, error: "Could not refresh run logs." });
    } finally {
      if (this.active && generation === this.generation)
        this.timer = setTimeout(() => void this.refresh(), 5000);
    }
  };
  loadOlder = async () => {
    const data = this.state.data;
    if (!data || data.olderCursor === null || this.state.loadingOlder) return;
    clearTimeout(this.timer);
    const generation = ++this.generation;
    this.update({ loadingOlder: true });
    try {
      const older = await this.transport.diagnostics({
        runId: data.run.id,
        before: data.olderCursor,
      });
      if (generation !== this.generation) return;
      this.update({
        data: {
          ...data,
          events: [
            ...new Map(
              [...older.events, ...data.events].map((event) => [event.id, event]),
            ).values(),
          ].sort((a, b) => a.seq - b.seq),
          olderCursor: older.olderCursor,
        },
        error: null,
      });
    } catch {
      if (generation === this.generation) this.update({ error: "Could not load earlier events." });
    } finally {
      if (generation === this.generation) {
        this.update({ loadingOlder: false });
        if (this.active) this.timer = setTimeout(() => void this.refresh(), 5000);
      }
    }
  };
}
