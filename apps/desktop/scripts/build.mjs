import { readFileSync } from "node:fs";
import { build } from "esbuild";

// Linux update signatures are read from the releases of the repository the update feed reads.
const { build: builder } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
const feed = [builder?.publish ?? []].flat().find((entry) => entry?.provider === "github");
const updateRepository = feed ? `${feed.owner}/${feed.repo}` : "";

await build({
  entryPoints: ["src/main/main.ts"],
  outfile: "dist/main.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: true,
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
  external: ["electron", "electron-updater", "koffi", "@sentry/electron"],
  // Only the release workflow's builds report errors; local and agent builds never do.
  define: {
    "process.env.RAKAZO_DESKTOP_RELEASE": JSON.stringify(process.env.RAKAZO_DESKTOP_RELEASE ?? ""),
    // Self-hosted builds associated with their own passkey domain (see src/main/auth/passkeys.ts).
    "process.env.RAKAZO_PASSKEY_RP_ID": JSON.stringify(process.env.RAKAZO_PASSKEY_RP_ID ?? ""),
    "process.env.RAKAZO_DESKTOP_UPDATE_REPOSITORY": JSON.stringify(updateRepository),
    // The public key Linux updates are signed with; without it the build offers no Linux updates.
    "process.env.RAKAZO_LINUX_UPDATE_PUBLIC_KEY": JSON.stringify(
      process.env.RAKAZO_LINUX_UPDATE_PUBLIC_KEY ?? "",
    ),
  },
});
