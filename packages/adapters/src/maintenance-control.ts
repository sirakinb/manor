import { createHash, randomUUID } from "node:crypto";
import { Agent, request } from "undici";
import { z } from "zod";

/** Fixed operator socket. Credentials never enter a browser, model or workspace. */
export class MaintenanceControl {
  private readonly dispatcher: Agent;
  constructor(
    socketPath: string,
    private readonly tokens: Record<"workspace" | "developer" | "owner" | "application", string>,
  ) {
    if (!socketPath.startsWith("/") || Object.values(tokens).some((token) => token.length < 32))
      throw new Error("Maintenance control configuration is incomplete.");
    this.dispatcher = new Agent({ connect: { socketPath } });
  }

  async call(
    role: keyof MaintenanceControl["tokens"],
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const response = await request(`http://localhost${path}`, {
      dispatcher: this.dispatcher,
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${this.tokens[role]}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      headersTimeout: 10_000,
      bodyTimeout: 10_000,
    });
    let text = "";
    for await (const chunk of response.body) {
      text += chunk.toString();
      if (text.length > 1024 * 1024) {
        response.body.destroy();
        throw new Error("Maintenance control response exceeded its limit.");
      }
    }
    if (response.statusCode !== 200) throw new Error("Maintenance control refused the request.");
    return JSON.parse(text);
  }

  async close() {
    await this.dispatcher.close();
  }
}

export function maintenanceOperationId(value: string): string {
  const hash = createHash("sha256").update(`manor-maintenance-v1:${value}`).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export type MaintenanceTransport = Pick<MaintenanceControl, "call">;

export function maintenanceControlFromEnv(env: NodeJS.ProcessEnv = process.env) {
  if (!env.MAINTENANCE_CONTROL_SOCKET) return undefined;
  return new MaintenanceControl(env.MAINTENANCE_CONTROL_SOCKET, {
    workspace: env.MAINTENANCE_WORKSPACE_TOKEN ?? "",
    developer: env.MAINTENANCE_DEVELOPER_TOKEN ?? "",
    owner: env.MAINTENANCE_OWNER_TOKEN ?? "",
    application: env.MAINTENANCE_APPLICATION_TOKEN ?? "",
  });
}

/** A lease is never aged out: uncertain completion must block, not race a backup. */
export class MaintenanceAdmission {
  constructor(
    private readonly control: MaintenanceTransport,
    private readonly instance: string,
  ) {
    if (!/^[a-f0-9]{12,64}$/.test(instance))
      throw new Error("A container identity is required for maintenance admission.");
  }
  async ready(): Promise<boolean> {
    try {
      z.object({ ready: z.literal(true) }).parse(
        await this.control.call(
          "application",
          "/v1/admission/probe",
          {},
          AbortSignal.timeout(3000),
        ),
      );
      return true;
    } catch {
      return false;
    }
  }
  async enter() {
    const body = { id: randomUUID(), instance: this.instance };
    z.object({ accepted: z.literal(true) }).parse(
      await this.control.call(
        "application",
        "/v1/admission/enter",
        body,
        AbortSignal.timeout(5000),
      ),
    );
    return async () => {
      // Retrying this exact leave is safe. If all attempts fail, the durable lease
      // stays present and deployment refuses to drain until operator recovery.
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          z.object({ released: z.literal(true) }).parse(
            await this.control.call(
              "application",
              "/v1/admission/leave",
              body,
              AbortSignal.timeout(5000),
            ),
          );
          return;
        } catch {
          if (attempt === 2)
            throw new Error("Maintenance admission completion could not be confirmed.");
        }
      }
    };
  }
  async run<T>(work: () => Promise<T>): Promise<T> {
    const leave = await this.enter();
    try {
      return await work();
    } finally {
      await leave().catch(() => console.error("Maintenance admission completion is unconfirmed."));
    }
  }
}
