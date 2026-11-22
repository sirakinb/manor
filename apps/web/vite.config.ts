// Modified for Manor: include the distribution's license and attribution texts in web builds.
import { readFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { lingui } from "@lingui/vite-plugin";
import { buildIdAt } from "@rakazo/contracts/client-build";
import {
  appContentSecurityPolicy,
  COMPUTER_SCREEN_PREFIX,
  COMPUTER_SCREEN_RUNTIME_PATH,
  contentSecurityPolicyFor,
  parseContentSecuritySources,
  parseCrispWebsiteId,
  parsePrimaryWebOrigin,
  primaryOriginFrameSources,
} from "@rakazo/contracts/content-security-policy";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { PreviewServer, ProxyOptions, ViteDevServer } from "vite";
import { defineConfig, loadEnv } from "vite";
import { wuyingScreenAssets } from "../../packages/adapters/src/wuying-screen-assets.ts";
import { wuyingScreenPolicy } from "../../packages/adapters/src/wuying-screen-policy.ts";
import { brandHostnames } from "../../packages/brands/src/index.ts";
import { createServiceLogger } from "../../packages/logging/src/env.ts";
import { socialPreviewPlugin } from "./social-preview-plugin";
import { apiProxy, DEVICE_SOCKET } from "./src/api-proxy.js";
import { withInstanceThemeLink } from "./src/instance-theme.js";
import {
  attachDesktopStackProbe,
  attachNovncProxy,
  attachPreviewMiddleware,
  sharedPageHeaders,
  webServerSettings,
} from "./src/preview-middleware.js";
import { rakazoPwa } from "./src/pwa/plugin.js";
import {
  resolvePreviewTarget,
  rewritePreviewCss,
  rewritePreviewHtml,
  safeProxyHeaders,
  safeProxyResponseHeaders,
} from "./src/screen-proxy.js";

const PREVIEW_REWRITE_LIMIT = 4 * 1024 * 1024;

/**
 * `/preview/…` → an app port inside a bot computer (signed capability minted by
 * the API). HTML and CSS bodies are rewritten so absolute asset paths resolve
 * under the proxy prefix; everything else streams through untouched.
 */
function attachPreviewProxy(server: ViteDevServer | PreviewServer, secret: string) {
  server.middlewares.use((req, res, next) => {
    if (!req.url?.startsWith("/preview/")) {
      next();
      return;
    }
    const target = resolvePreviewTarget(req.url, secret);
    if (!target) {
      res.statusCode = 403;
      res.end("Invalid or expired preview link");
      return;
    }
    const headers = {
      ...safeProxyHeaders(req.headers),
      host: `${target.hostname}:${target.port}`,
      // Ask for identity so HTML/CSS can be rewritten; other bodies stream through.
      "accept-encoding": "identity",
    };
    const upstream = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.path,
        method: req.method,
        headers,
      },
      (incoming) => {
        const contentType = String(incoming.headers["content-type"] ?? "").toLowerCase();
        const rewrite = contentType.includes("text/html")
          ? rewritePreviewHtml
          : contentType.includes("text/css")
            ? rewritePreviewCss
            : null;
        const responseHeaders: Record<string, string | string[]> = {
          ...safeProxyResponseHeaders(incoming.headers),
        };
        // Upstream redirects to absolute paths must stay under the prefix.
        const location = incoming.headers.location;
        if (
          typeof location === "string" &&
          location.startsWith("/") &&
          !location.startsWith("//")
        ) {
          responseHeaders.location = `${target.prefix}${location}`;
        }
        delete responseHeaders["content-security-policy"];
        delete responseHeaders["x-frame-options"];
        if (!rewrite || incoming.headers["content-encoding"]) {
          res.writeHead(incoming.statusCode ?? 502, responseHeaders);
          incoming.pipe(res);
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        incoming.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
          size += chunk.length;
        });
        incoming.on("end", () => {
          const body = Buffer.concat(chunks, size);
          const out =
            size > PREVIEW_REWRITE_LIMIT
              ? body
              : Buffer.from(rewrite(body.toString("utf8"), target.prefix), "utf8");
          delete responseHeaders["content-length"];
          delete responseHeaders["transfer-encoding"];
          res.writeHead(incoming.statusCode ?? 502, {
            ...responseHeaders,
            "content-length": String(out.length),
          });
          res.end(out);
        });
        incoming.on("error", () => {
          if (!res.headersSent) res.statusCode = 502;
          res.end();
        });
      },
    );
    upstream.on("error", (error) => {
      res.statusCode = 502;
      res.end(`Preview is not reachable on port ${target.port}: ${error.message}`);
    });
    req.pipe(upstream);
  });

  // Dev servers use a websocket for live reload; tunnel it like the screen proxy does.
  server.httpServer?.on("upgrade", (req, socket, head) => {
    if (!req.url?.startsWith("/preview/")) return;
    const target = resolvePreviewTarget(req.url, secret);
    if (!target) {
      socket.destroy();
      return;
    }
    const upstream = net.connect(target.port, target.hostname);
    upstream.once("connect", () => {
      const headerLines = [
        `${req.method ?? "GET"} ${target.path} HTTP/1.1`,
        `Host: ${target.hostname}:${target.port}`,
      ];
      for (const [key, value] of Object.entries(safeProxyHeaders(req.headers))) {
        headerLines.push(`${key}: ${Array.isArray(value) ? value.join(",") : value}`);
      }
      upstream.write(`${headerLines.join("\r\n")}\r\n\r\n`);
      if (head.length) upstream.write(head);
      socket.pipe(upstream);
      upstream.pipe(socket);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
  });
}

export default defineConfig(({ command, mode }) => {
  // Names this build in every API request; the dev server has none, so the handshake stays off.
  const buildId = command === "build" ? buildIdAt(new Date()) : "";
  const rootEnv = loadEnv(mode, path.resolve(import.meta.dirname, "../.."), "");
  const webPort = Number(process.env.WEB_PORT ?? rootEnv.WEB_PORT ?? 5173);
  const read = (name: string) => process.env[name] ?? rootEnv[name];
  const settings = webServerSettings(read, createServiceLogger({ service: "rakazo-web" }));
  const { api, appPolicy, instanceTheme } = settings;
  // Client brand hostnames are served by the same app.
  const allowedHosts = [...new Set([...settings.allowedHosts, ...brandHostnames()])];
  // Set by the server built from this config; reusing one config object for two servers would
  // leave the last one's list.
  let proxyHosts: readonly string[] | true = [];
  const upstreamProxy = apiProxy(api, () => proxyHosts);
  // Manor keeps the browser's Host: the API picks the brand and client portal from it.
  const keepHost = (options: ProxyOptions | undefined): ProxyOptions => ({
    ...options,
    changeOrigin: false,
  });
  const manorApi = keepHost(upstreamProxy["/api"]);
  const proxy: Record<string, ProxyOptions> = {
    ...Object.fromEntries(
      Object.entries(upstreamProxy).map(([key, options]) => [key, keepHost(options)]),
    ),
    // Manor's OpenAI-compatible API and the CRM and Workspace MCP servers.
    "/v1": manorApi,
    "^/mcp/(crm|workspace)(?:[/?]|$)": manorApi,
    // OAuth for MCP clients.
    "^/(\\.well-known/oauth-|oauth/(register|token)(?:[/?]|$))": manorApi,
    // Share this Mac connects over a websocket, with the same host check as the device socket.
    "/local-computer": keepHost(upstreamProxy[DEVICE_SOCKET]),
  };
  // Manor: brand portal pages frame app previews from the primary origin (WEB_ORIGIN). The same
  // extensions webServerSettings parses for appPolicy, plus that frame source on other hosts.
  const cspExtensions = {
    scriptSrc: parseContentSecuritySources("RAKAZO_CSP_SCRIPT_SRC", read("RAKAZO_CSP_SCRIPT_SRC")),
    connectSrc: parseContentSecuritySources(
      "RAKAZO_CSP_CONNECT_SRC",
      read("RAKAZO_CSP_CONNECT_SRC"),
    ),
    crisp: parseCrispWebsiteId(read("CRISP_WEBSITE_ID")) !== null,
  };
  const primaryWebOrigin = parsePrimaryWebOrigin("WEB_ORIGIN", read("WEB_ORIGIN"));
  const policyForHost = (host: string | undefined) => {
    const frameSrc = primaryOriginFrameSources(primaryWebOrigin, host);
    return frameSrc.length ? appContentSecurityPolicy({ ...cspExtensions, frameSrc }) : appPolicy;
  };
  return {
    build: {
      sourcemap: true,
      rolldownOptions: {
        output: {
          codeSplitting: {
            // Shared chunks that build schemas run before the entry chunk's body, so the Zod
            // config only lands in time when it ships inside Zod's own chunk.
            groups: [
              { name: "zod", test: /[\\/]node_modules[\\/]zod[\\/]|[\\/]src[\\/]zod-config\.ts$/ },
            ],
          },
        },
      },
    },
    define: { "import.meta.env.RAKAZO_BUILD": JSON.stringify(buildId) },
    plugins: [
      {
        name: "manor-distribution-notices",
        generateBundle() {
          for (const name of ["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md"]) {
            this.emitFile({
              type: "asset",
              fileName: `licenses/${name}`,
              source: readFileSync(path.resolve(import.meta.dirname, "../..", name)),
            });
          }
        },
      },
      {
        // The API reads this to name the deployed build, and a tab fetches it to confirm the
        // server already serves a newer build before it reloads.
        name: "rakazo-build-id",
        apply: "build",
        generateBundle() {
          this.emitFile({ type: "asset", fileName: "build-id", source: `${buildId}\n` });
        },
      },
      react(),
      babel({ plugins: ["@lingui/babel-plugin-lingui-macro"] }),
      lingui(),
      tailwindcss(),
      rakazoPwa(buildId),
      {
        // Dev keeps React Refresh unrestricted in app pages; screen documents always use CSP.
        name: "rakazo-content-security-policy",
        generateBundle() {
          for (const [pathname, asset] of Object.entries(wuyingScreenAssets)) {
            this.emitFile({ type: "asset", fileName: pathname.slice(1), source: asset.source });
          }
        },
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            const pathname = req.url?.split("?", 1)[0] ?? "/";
            if (pathname.startsWith(COMPUTER_SCREEN_PREFIX)) {
              res.setHeader(
                "content-security-policy",
                contentSecurityPolicyFor(
                  pathname,
                  policyForHost(req.headers.host),
                  wuyingScreenPolicy,
                )!,
              );
              if (pathname !== COMPUTER_SCREEN_RUNTIME_PATH)
                res.setHeader("x-frame-options", "SAMEORIGIN");
            }
            const asset = Object.hasOwn(wuyingScreenAssets, pathname)
              ? wuyingScreenAssets[pathname]
              : undefined;
            if (asset) {
              res.setHeader("content-type", asset.type);
              res.end(asset.source);
              return;
            }
            next();
          });
          server.middlewares.use(sharedPageHeaders);
          if (instanceTheme) server.middlewares.use(instanceTheme);
          attachDesktopStackProbe(server, settings);
          // The hosts the running server allows, as Vite resolved them, for proxied upgrades.
          proxyHosts = server.config.server.allowedHosts;
          attachNovncProxy(server, settings);
        },
        configurePreviewServer(server) {
          proxyHosts = server.config.preview.allowedHosts;
          const { config } = server;
          const outDir = path.resolve(config.root, config.build.outDir);
          const afterFallback = attachPreviewMiddleware(server, settings, {
            root: config.root,
            outDir,
            assetsDir: path.join(outDir, config.build.assetsDir),
            assetsUrl: `${config.base}${config.build.assetsDir}/`,
          });
          // Manor, after upstream's headers: brand portals (other origins) frame app previews
          // from /preview/, and their pages may frame the primary origin.
          server.middlewares.use((req, res, next) => {
            const pathname = req.url?.split("?", 1)[0] ?? "/";
            if (pathname.startsWith("/preview/")) res.removeHeader("x-frame-options");
            const policy = contentSecurityPolicyFor(
              pathname,
              policyForHost(req.headers.host),
              wuyingScreenPolicy,
            );
            if (policy) res.setHeader("content-security-policy", policy);
            next();
          });
          // Returned as a post hook, so it runs after Vite's SPA fallback has resolved the page.
          return afterFallback;
        },
      },
      // Manor: after the CSP plugin, so brand-host pages it serves still carry the policy.
      socialPreviewPlugin(),
      {
        // Without RAKAZO_THEME the page never links the theme, so the default deploy is unchanged.
        name: "rakazo-instance-theme",
        transformIndexHtml: (html) =>
          command === "serve" && instanceTheme ? withInstanceThemeLink(html) : html,
      },
      {
        name: "rakazo-preview-proxy",
        configureServer: (server) => attachPreviewProxy(server, settings.screenProxySecret()),
        configurePreviewServer: (server) =>
          attachPreviewProxy(server, settings.screenProxySecret()),
      },
    ],
    server: {
      host: process.env.RAKAZO_DEV_HOST ?? rootEnv.RAKAZO_DEV_HOST ?? "127.0.0.1",
      port: webPort,
      strictPort: true,
      allowedHosts,
      proxy,
    },
    preview: {
      host: "0.0.0.0",
      port: webPort,
      allowedHosts,
      proxy,
    },
  };
});
