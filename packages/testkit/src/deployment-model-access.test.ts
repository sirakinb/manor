import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ComposioEmulator, InMemoryRealtimeFanout } from "@rakazo/adapters";
import type { ModelCatalogEntry } from "@rakazo/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sessionCookieHeader } from "./index.js";

process.env.WAKEUP_DRIVER = "memory";
process.env.SANDBOX_PROVIDER = "fake";
process.env.AGENT_RUNTIME = "scripted";

const describeDb =
  process.env.VERIFY_DATABASE === "1" && process.env.DATABASE_URL ? describe : describe.skip;

describeDb("bot model access through a deployment connection", () => {
  let handles: Awaited<ReturnType<typeof import("../../../apps/api/src/app.ts").createApp>>;
  let cookie: string;
  const dataDir = mkdtempSync(path.join(tmpdir(), "model-access-"));
  async function call(procedure: string, body: unknown = {}) {
    return handles.app.request(`/rpc/${procedure}`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json", origin: "http://127.0.0.1:5173" },
      body: JSON.stringify({ json: body }),
    });
  }
  beforeAll(async () => {
    const { createApp } = await import("../../../apps/api/src/app.ts");
    handles = await createApp({
      databaseUrl: process.env.DATABASE_URL!,
      dataDir,
      sandboxProvider: "fake",
      agentRuntime: "scripted",
      wakeupDriver: "memory",
      realtime: new InMemoryRealtimeFanout(),
      composio: new ComposioEmulator(),
      signupsEnabled: "true",
      defaultProvider: "openrouter",
      deploymentModelKey: "synthetic-shared-key",
    });
    const response = await handles.app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://127.0.0.1:5173" },
      body: JSON.stringify({
        email: `model-access-${Date.now()}@example.test`,
        password: "password12",
        name: "Model Tester",
      }),
    });
    expect(response.status).toBeLessThan(400);
    cookie = sessionCookieHeader(response);
  });
  afterAll(async () => {
    await handles?.stop();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("saves catalog models on the shared provider, but rejects other providers and unknown models", async () => {
    expect((await (await call("models/credentials")).json()).json).toEqual([]);
    const { json: catalog } = (await (await call("models/list")).json()) as {
      json: ModelCatalogEntry[];
    };
    const choices = catalog.filter((entry) => entry.deploymentAvailable && !entry.placeholder);
    expect(choices.length).toBeGreaterThan(1);
    const created = await call("bots/create", {
      name: "Analyst",
      title: "",
      description: "",
      instructions: "",
      notifyOnFinish: false,
    });
    expect(created.status).toBe(200);
    const { json: bot } = await created.json();
    for (const choice of choices.slice(0, 2)) {
      const saved = await call("bots/update", {
        botId: bot.id,
        modelProvider: choice.provider,
        modelId: choice.id,
      });
      expect(saved.status).toBe(200);
      expect((await saved.json()).json).toMatchObject({
        modelProvider: choice.provider,
        modelId: choice.id,
      });
    }
    const unknown = await call("bots/update", {
      botId: bot.id,
      modelProvider: "openrouter",
      modelId: "not-a-real-model",
    });
    expect(unknown.status).toBe(400);
    const other = catalog.find((entry) => entry.provider === "anthropic" && !entry.placeholder)!;
    const disconnected = await call("bots/update", {
      botId: bot.id,
      modelProvider: other.provider,
      modelId: other.id,
    });
    expect(disconnected.status).toBe(400);
  });
});
