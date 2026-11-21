import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function read(relative: string) {
  return readFileSync(path.join(repoRoot, relative), "utf8");
}

describe("local computer ingress", () => {
  it("proxies /local-computer as a websocket to the API in vite server and preview", () => {
    const vite = read("apps/web/vite.config.ts");
    // One API proxy table serves both the dev server and preview (upstream's shape); Manor
    // keeps the browser's Host and adds Share this Mac's socket with the device socket's options.
    const table = vite.slice(
      vite.indexOf("const upstreamProxy"),
      vite.indexOf("const screenProxySecret"),
    );
    expect(table).toContain('"/local-computer": keepHost(upstreamProxy[DEVICE_SOCKET])');
    expect(table).toMatch(/changeOrigin:\s*false/);
    expect(vite.match(/^\s+proxy,$/gm)).toHaveLength(2);
  });

  it("routes /local-computer to the API in both Caddyfiles", () => {
    for (const file of [
      "infra/compose/Caddyfile.prod",
      "infra/compose/Caddyfile.cloudflare.example",
    ]) {
      expect(read(file)).toMatch(/handle \/local-computer\s*\{/);
    }
  });
});
