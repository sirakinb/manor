import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  MaintenanceAdmission,
  MaintenanceControl,
  maintenanceControlFromEnv,
  maintenanceOperationId,
} from "./maintenance-control.js";

describe("maintenance admission client", () => {
  it("requires an authenticated live guard probe without acquiring a writer lease", async () => {
    const call = vi.fn().mockResolvedValue({ ready: true });
    const gate = new MaintenanceAdmission({ call }, "a".repeat(12));
    expect(await gate.ready()).toBe(true);
    expect(call.mock.calls[0]?.slice(0, 3)).toEqual(["application", "/v1/admission/probe", {}]);
    call.mockRejectedValue(new Error("invalid credentials or unavailable"));
    expect(await gate.ready()).toBe(false);
  });
  it("does not execute work when admission is closed or unreachable", async () => {
    const call = vi.fn().mockRejectedValue(new Error("closed"));
    const work = vi.fn();
    await expect(new MaintenanceAdmission({ call }, "a".repeat(12)).run(work)).rejects.toThrow();
    expect(work).not.toHaveBeenCalled();
  });
  it("holds a durable lease through failed work and releases that same identity", async () => {
    const call = vi.fn(async (_role: string, path: string, _body?: unknown) =>
      path.endsWith("enter") ? { accepted: true } : { released: true },
    );
    const gate = new MaintenanceAdmission({ call }, "a".repeat(12));
    await expect(
      gate.run(async () => {
        throw new Error("work failed");
      }),
    ).rejects.toThrow("work failed");
    expect(call.mock.calls.map((args) => args[1])).toEqual([
      "/v1/admission/enter",
      "/v1/admission/leave",
    ]);
    expect(call.mock.calls[0]![2]).toEqual(call.mock.calls[1]![2]);
  });
  it("retries an uncertain leave without inventing a new lease or reopening admission", async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce({ accepted: true })
      .mockRejectedValueOnce(new Error("lost reply"))
      .mockResolvedValue({ released: true });
    await new MaintenanceAdmission({ call }, "b".repeat(12)).run(async () => undefined);
    expect(call.mock.calls).toHaveLength(3);
    expect(call.mock.calls[1]![2]).toEqual(call.mock.calls[2]![2]);
  });
  it("never enables production through missing or partial configuration", () => {
    expect(maintenanceControlFromEnv({})).toBeUndefined();
    expect(() =>
      maintenanceControlFromEnv({ MAINTENANCE_CONTROL_SOCKET: "/synthetic/control.sock" }),
    ).toThrow();
    expect(() => new MaintenanceAdmission({ call: vi.fn() }, "unverified-host")).toThrow();
  });
  it("maps logical identities to stable distinct UUIDs", () => {
    expect(maintenanceOperationId("a:approve")).toMatch(
      /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-a[a-f0-9]{3}-[a-f0-9]{12}$/,
    );
    expect(maintenanceOperationId("a:approve")).toBe(maintenanceOperationId("a:approve"));
    expect(maintenanceOperationId("a:approve")).not.toBe(maintenanceOperationId("a:deploy"));
  });
});

describe("maintenance Unix transport", () => {
  it("uses the private socket and role credential and refuses non-success replies", async () => {
    const directory = await mkdtemp(join(tmpdir(), "manor-control-"));
    const socket = join(directory, "control.sock");
    const tokens = {
      workspace: "w".repeat(40),
      developer: "d".repeat(40),
      owner: "o".repeat(40),
      application: "a".repeat(40),
    };
    const received: string[] = [];
    const server = createServer((request, response) => {
      received.push(request.headers.authorization ?? "");
      response.writeHead(request.url === "/refused" ? 409 : 200, {
        "content-type": "application/json",
      });
      response.end(JSON.stringify({ state: "queued" }));
    });
    const control = new MaintenanceControl(socket, tokens);
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(socket, resolve);
      });
      expect(
        await control.call("workspace", "/v1/workspaces/operations", { action: "create" }),
      ).toEqual({ state: "queued" });
      await expect(control.call("developer", "/refused")).rejects.toThrow("refused");
      await expect(
        control.call("workspace", "/v1/workspaces/operations", { argv: ["界".repeat(180000)] }),
      ).rejects.toThrow("request exceeded");
      expect(received).toEqual([`Bearer ${tokens.workspace}`, `Bearer ${tokens.developer}`]);
    } finally {
      await control.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  });
});
