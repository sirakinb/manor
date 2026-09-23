import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Offline stand-in for TypeSafe's System One API in E2E: actions always fit, and every reply
 * statement is unsupported so the answer-check note is visible.
 */
export async function startJevEmulator(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const { questions = {} } = JSON.parse(body || "{}") as {
        questions?: Record<string, unknown>;
      };
      const answers = Object.fromEntries(
        Object.keys(questions).map((key) => [
          key,
          key === "action_fit"
            ? {
                type: "choice",
                choice: "fits",
                probabilities: { fits: 0.9, unexpected: 0.1 },
                confidence: 0.9,
              }
            : { type: "noul", noul: 0.2 },
        ]),
      );
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({ model: "jev-emulator", answers, usage: { input_tokens: 100 } }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
