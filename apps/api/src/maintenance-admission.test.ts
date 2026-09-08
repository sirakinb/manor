import { Hono } from "hono";
import { cors } from "hono/cors";
import { describe, expect, it, vi } from "vitest";
import { mountMaintenanceAdmission } from "./maintenance-admission.js";

describe("API maintenance admission", () => {
  it("blocks mutation handlers and retains CORS and retry information", async () => {
    const app = new Hono();
    app.use("*", cors({ origin: "https://client.example.test", credentials: true }));
    mountMaintenanceAdmission(app, { enter: vi.fn().mockRejectedValue(new Error("closed")) });
    const mutate = vi.fn((c) => c.json({ changed: true }));
    app.post("/rpc/threads/send", mutate);
    const response = await app.request("/rpc/threads/send", {
      method: "POST",
      headers: { Origin: "https://client.example.test" },
    });
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("10");
    expect(response.headers.get("access-control-allow-origin")).toBe("https://client.example.test");
    expect(mutate).not.toHaveBeenCalled();
  });
  it("keeps owner authorization inside exempt maintenance routes", async () => {
    const app = new Hono();
    const enter = vi.fn().mockRejectedValue(new Error("closed"));
    mountMaintenanceAdmission(app, { enter });
    app.post("/rpc/maintenance/approve", (c) => c.json({ error: "owner required" }, 403));
    app.post("/rpc/maintenance-escape", (c) => c.json({ changed: true }));
    app.get("/health", (c) => c.json({ ok: true }));
    expect((await app.request("/rpc/maintenance/approve", { method: "POST" })).status).toBe(403);
    expect(enter).not.toHaveBeenCalled();
    expect((await app.request("/rpc/maintenance-escape", { method: "POST" })).status).toBe(503);
    expect((await app.request("/health")).status).toBe(200);
  });
  it("does not turn committed work into a retry when lease completion is uncertain", async () => {
    const app = new Hono();
    const leave = vi.fn().mockRejectedValue(new Error("lost response"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mountMaintenanceAdmission(app, { enter: vi.fn().mockResolvedValue(leave) });
    app.post("/rpc/work", (c) => c.json({ committed: true }));
    expect(await (await app.request("/rpc/work", { method: "POST" })).json()).toEqual({
      committed: true,
    });
    expect(leave).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
