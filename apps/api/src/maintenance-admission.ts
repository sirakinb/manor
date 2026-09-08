import type { MaintenanceAdmission } from "@rakazo/adapters";
import type { Hono } from "hono";

/** Mount after CORS so a closed guard returns a readable response to web clients. */
export function mountMaintenanceAdmission(
  app: Hono,
  admission?: Pick<MaintenanceAdmission, "enter">,
) {
  if (!admission) return;
  app.use("*", async (c, next) => {
    const path = c.req.path;
    // Maintenance RPCs still perform authoritative owner authorization. Read-only
    // health/identity and release polling must work during a guarded rollout.
    if (path === "/health" || path === "/rpc/me" || path.startsWith("/rpc/maintenance/"))
      return next();
    let leave: () => Promise<void>;
    try {
      leave = await admission.enter();
    } catch {
      return c.json({ error: "Maintenance in progress. Try again shortly." }, 503, {
        "Retry-After": "10",
      });
    }
    try {
      await next();
    } finally {
      // A lost lease-completion reply must not turn a committed business mutation
      // into an apparent failure and encourage a duplicate user submission.
      await leave().catch(() => console.error("Maintenance admission completion is unconfirmed."));
    }
  });
}
