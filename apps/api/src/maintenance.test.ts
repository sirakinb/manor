import { RPCHandler } from "@orpc/server/fetch";
import type { Actor } from "@rakazo/contracts";
import { describe, expect, it, vi } from "vitest";
import { createRouter, type RouterDeps } from "./router.js";

const inputs = {
  list: undefined,
  create: { requestId: "request-123", issue: "Synthetic issue" },
  approve: { id: "job-1", revision: "a".repeat(40), reviewKey: "review-1" },
  cancel: { id: "job-1" },
};

describe("maintenance RPC authorization", () => {
  for (const [action, input] of Object.entries(inputs)) {
    for (const actor of [
      null,
      { userId: "member", isDeploymentOwner: false },
      { userId: "organization-admin", isDeploymentOwner: false },
      { userId: "former-owner", isDeploymentOwner: true },
    ]) {
      it(`denies ${action} for ${actor?.userId ?? "anonymous"} before reading jobs or evidence`, async () => {
        const read = vi.fn(() => {
          throw new Error("must not access maintenance data");
        });
        const prisma = {
          deploymentSettings: {
            findUnique: vi.fn().mockResolvedValue({ ownerUserId: "current-owner" }),
          },
          maintenanceJob: { findMany: read, findFirst: read, upsert: read },
          run: { findFirst: read },
        };
        const handler = new RPCHandler(createRouter({ prisma, env: {} } as unknown as RouterDeps));
        const { response } = await handler.handle(
          new Request(`http://localhost/rpc/maintenance/${action}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ json: input }),
          }),
          {
            prefix: "/rpc",
            context: {
              actor: actor
                ? ({ ...actor, spaceId: "organization", email: "synthetic@example.test" } as Actor)
                : null,
            },
          },
        );
        expect(response.status).toBe(actor ? 403 : 401);
        expect(read).not.toHaveBeenCalled();
      });
    }
  }
});
