import type { AppBootstrap } from "@rakazo/contracts";
import { initialBootstrapTarget } from "./bootstrap-target";
import { markOnce } from "./performance";
import { recoverInitialSpace, rpc, selectedSpaceId } from "./rpc";

let primedBootstrap: { botId?: string; promise: Promise<AppBootstrap> } | null = null;

const initialTarget = initialBootstrapTarget(
  window.location.pathname,
  Boolean(window.rakazoDesktop),
);
if (initialTarget) {
  const { botId } = initialTarget;
  const promise = requestBootstrap(botId);
  // Authentication can redirect before Shell consumes this speculative request.
  // Register a rejection handler immediately while preserving rejection for a consumer.
  void promise.catch(() => undefined);
  primedBootstrap = { botId, promise };
}

export function takeInitialBootstrap(botId?: string) {
  const primed = primedBootstrap;
  primedBootstrap = null;
  if (primed && primed.botId === botId) return primed.promise;
  return requestBootstrap(botId);
}

async function requestBootstrap(botId?: string) {
  markOnce("rk:renderer:bootstrap-request-start");
  const spaceId = selectedSpaceId();
  const bootstrap = await rpc.bootstrap(botId ? { botId } : {}).catch(async (error) => {
    await recoverInitialSpace(error, spaceId);
    return rpc.bootstrap({});
  });
  markOnce("rk:renderer:bootstrap-response");
  return bootstrap;
}
