import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { unwrapEnvFromKeyManager } from "@rakazo/adapters";
import { loadRootEnv } from "@rakazo/core/node/load-root-env";
import { stopOnShutdownSignals } from "@rakazo/core/node/shutdown-signals";

loadRootEnv();
await unwrapEnvFromKeyManager();

import { serve } from "@hono/node-server";
import { SERVICE_NAMES } from "@rakazo/logging";
import { createRootLogger } from "@rakazo/logging/axiom";
import { watchEventLoopStalls } from "@rakazo/logging/event-loop";
import { createApp } from "./app.js";
import { trackConnections } from "./drain.js";
import { loadEnv } from "./env.js";
import { LOCAL_COMPUTER_SOCKET_PATH } from "./local-computer.js";

const logger = await createRootLogger(SERVICE_NAMES.api);
const stopStallWatch = watchEventLoopStalls("api.event_loop_stalled");

try {
  const env = loadEnv();
  const { app, stop, attachLocalComputer, handleUpgrade } = await createApp({ ...env, logger });
  const server = serve({ fetch: app.fetch, port: env.port, hostname: env.apiHost }, () => {
    logger.info("api listening", { "http.host": env.apiHost, "http.port": env.port });
  });
  const detachLocalComputer = attachLocalComputer(server);
  // Desktop apps hold an outbound socket so bots can reach the user's own computer.
  // Manor: that handler refuses every other path, so it skips the "This Mac" socket.
  if (handleUpgrade) {
    server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      const path = new URL(request.url ?? "/", "http://api").pathname;
      if (path === LOCAL_COMPUTER_SOCKET_PATH) return;
      handleUpgrade(request, socket, head);
    });
  }

  // The deploy allows 30 seconds after the stop signal; leave time for stop() and the log flush.
  const drain = trackConnections(server as Server);

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    stopStallWatch();
    // Manor: the drain also refuses and closes "This Mac" sockets: they are upgrades too.
    await drain(20_000);
    detachLocalComputer();
    await stop();
    await logger.flush({ timeoutMs: 2_000 });
  };
  stopOnShutdownSignals(shutdown);
} catch (error) {
  logger.error("api startup failed", error);
  await logger.flush({ timeoutMs: 2_000 });
  process.exit(1);
}
