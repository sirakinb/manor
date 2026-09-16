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
    const matches = vite.match(
      /"\/local-computer":\s*\{\s*target:\s*api,\s*changeOrigin:\s*false,\s*ws:\s*true\s*\}/g,
    );
    expect(matches).toHaveLength(2);
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
