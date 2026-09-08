import type {
  MaintenanceApproval,
  MaintenanceCreate,
  MaintenanceJob,
  MaintenanceOverview,
} from "@rakazo/contracts";

export interface MaintenanceTransport {
  list(): Promise<MaintenanceOverview>;
  create(input: MaintenanceCreate): Promise<MaintenanceJob>;
  approve(input: MaintenanceApproval): Promise<MaintenanceJob>;
  cancel(input: { id: string }): Promise<MaintenanceJob>;
}

/** Shared polling and mutation serialization for web, Electron and native. */
export class MaintenanceController {
  private state = {
    data: null as MaintenanceOverview | null,
    loading: true,
    pending: false,
    error: "",
  };
  private listeners = new Set<() => void>();
  private generation = 0;
  private lifetime = 0;
  private active = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private transport: MaintenanceTransport) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<typeof this.state>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  start() {
    this.active = true;
    this.lifetime++;
    this.update({ pending: false });
    void this.refresh();
  }
  stop() {
    this.active = false;
    this.lifetime++;
    this.generation++;
    clearTimeout(this.timer);
  }
  refresh = async () => {
    clearTimeout(this.timer);
    const generation = ++this.generation;
    try {
      const data = await this.transport.list();
      if (generation === this.generation) this.update({ data, loading: false, error: "" });
    } catch {
      if (generation === this.generation)
        this.update({
          data: null,
          loading: false,
          error: "Maintenance is unavailable. Check your connection and deployment-owner access.",
        });
    } finally {
      if (this.active && generation === this.generation)
        this.timer = setTimeout(() => void this.refresh(), 5000);
    }
  };
  private async mutate(action: () => Promise<MaintenanceJob>) {
    if (this.state.pending) return false;
    this.generation++;
    clearTimeout(this.timer);
    const lifetime = this.lifetime;
    this.update({ pending: true, error: "" });
    try {
      await action();
      if (lifetime !== this.lifetime) return false;
      await this.refresh();
      return true;
    } catch {
      if (lifetime !== this.lifetime) return false;
      this.update({
        error:
          "The action could not be confirmed. Refresh and review the current job before retrying.",
      });
      return false;
    } finally {
      if (lifetime === this.lifetime) {
        this.update({ pending: false });
        clearTimeout(this.timer);
        if (this.active) this.timer = setTimeout(() => void this.refresh(), 5000);
      }
    }
  }
  create(input: MaintenanceCreate) {
    return this.mutate(() => this.transport.create(input));
  }
  approve(job: MaintenanceJob) {
    if (!job.review || !job.reviewKey) return Promise.resolve(false);
    return this.mutate(() =>
      this.transport.approve({
        id: job.id,
        revision: job.review!.revision,
        reviewKey: job.reviewKey!,
      }),
    );
  }
  cancel(id: string) {
    return this.mutate(() => this.transport.cancel({ id }));
  }
}
