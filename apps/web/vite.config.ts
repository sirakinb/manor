// Modified for Manor: include the distribution's license and attribution texts in web builds.
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import tls from "node:tls";
import { lingui } from "@lingui/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type PreviewServer, type ViteDevServer } from "vite";
import { brandHostnames } from "../../packages/brands/src/index.ts";
import { resolveScreenProxySecret } from "../../packages/core/src/secrets-guard.ts";
import {
  resolveNovncTarget,
  resolvePreviewTarget,
  rewritePreviewCss,
  rewritePreviewHtml,
  safeProxyHeaders,
  safeProxyResponseHeaders,
  stripSensitiveHandshakeHeaders,
} from "./src/screen-proxy.js";

const webPort = Number(process.env.WEB_PORT ?? 5173);

function attachNovncProxy(server: ViteDevServer | PreviewServer, secret: string) {
  server.middlewares.use((req, res, next) => {
    if (!req.url?.startsWith("/novnc/")) {
      next();
      return;
    }
    const target = resolveNovncTarget(req.url, secret);
    if (!target) {
      res.statusCode = 403;
      res.end("Invalid or expired screen capability");
      return;
    }
    const headers = {
      ...safeProxyHeaders(req.headers),
      host: `${target.hostname}:${target.port}`,
    };
    const transport = target.protocol === "https:" ? https : http;
    const upstream = transport.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.path,
        method: req.method,
        headers,
        ...(target.protocol === "https:" ? { servername: target.hostname } : {}),
      },
      (incoming) => {
        res.writeHead(incoming.statusCode ?? 502, {
          ...safeProxyResponseHeaders(incoming.headers),
          "access-control-allow-origin": "*",
        });
        incoming.pipe(res);
      },
    );
    upstream.on("error", (error) => {
      res.statusCode = 502;
      res.end(error.message);
    });
    req.pipe(upstream);
  });

  server.httpServer?.on("upgrade", (req, socket, head) => {
    if (!req.url?.startsWith("/novnc/")) return;
    const target = resolveNovncTarget(req.url, secret);
    if (!target) {
      socket.destroy();
      return;
    }
    const upstream =
      target.protocol === "https:"
        ? tls.connect({ port: target.port, host: target.hostname, servername: target.hostname })
        : net.connect(target.port, target.hostname);
    upstream.once(target.protocol === "https:" ? "secureConnect" : "connect", () => {
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
      const responseChunks: Buffer[] = [];
      let responseSize = 0;
      let responseTail = Buffer.alloc(0);
      const forwardHandshake = (chunk: Buffer) => {
        responseChunks.push(chunk);
        responseSize += chunk.length;
        if (responseSize > 64 * 1024) {
          socket.destroy();
          upstream.destroy();
          return;
        }
        const boundarySearch = Buffer.concat([responseTail, chunk]);
        if (boundarySearch.indexOf("\r\n\r\n") < 0) {
          responseTail = Buffer.from(boundarySearch.subarray(-3));
          return;
        }
        const responseHead = Buffer.concat(responseChunks, responseSize);
        const safe = stripSensitiveHandshakeHeaders(responseHead);
        if (!safe) {
          socket.destroy();
          upstream.destroy();
          return;
        }
        upstream.off("data", forwardHandshake);
        socket.write(safe);
        upstream.pipe(socket);
      };
      upstream.on("data", forwardHandshake);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
  });
}

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

export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, path.resolve(import.meta.dirname, "../.."), "");
  const api = process.env.API_PROXY_TARGET ?? rootEnv.API_PROXY_TARGET ?? "http://127.0.0.1:3100";
  const previewHost = process.env.RAKAZO_HOST ?? rootEnv.RAKAZO_HOST ?? "localhost";
  const screenProxySecret = () =>
    resolveScreenProxySecret({
      ...process.env,
      SCREEN_PROXY_SECRET: process.env.SCREEN_PROXY_SECRET ?? rootEnv.SCREEN_PROXY_SECRET,
      SANDBOX_SUPERVISOR_TOKEN:
        process.env.SANDBOX_SUPERVISOR_TOKEN ?? rootEnv.SANDBOX_SUPERVISOR_TOKEN,
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? rootEnv.BETTER_AUTH_SECRET,
    });
  const performanceAssetDelayMs = Number(process.env.RAKAZO_PERFORMANCE_ASSET_DELAY_MS ?? 0);
  return {
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
      react({
        babel: {
          plugins: ["@lingui/babel-plugin-lingui-macro"],
        },
      }),
      lingui(),
      tailwindcss(),
      {
        name: "rakazo-performance-asset-delay",
        configurePreviewServer(server) {
          if (!Number.isFinite(performanceAssetDelayMs) || performanceAssetDelayMs <= 0) return;
          server.middlewares.use((req, _res, next) => {
            const pathname = req.url?.split("?", 1)[0] ?? "/";
            if (
              ["/api", "/rpc", "/v1", "/mcp", "/novnc", "/preview"].some((prefix) =>
                pathname.startsWith(prefix),
              )
            ) {
              next();
              return;
            }
            setTimeout(next, performanceAssetDelayMs);
          });
        },
      },
      {
        name: "rakazo-novnc-proxy",
        configureServer: (server) => attachNovncProxy(server, screenProxySecret()),
        configurePreviewServer: (server) => attachNovncProxy(server, screenProxySecret()),
      },
      {
        name: "rakazo-preview-proxy",
        configureServer: (server) => attachPreviewProxy(server, screenProxySecret()),
        configurePreviewServer: (server) => attachPreviewProxy(server, screenProxySecret()),
      },
    ],
    server: {
      host: "127.0.0.1",
      port: webPort,
      strictPort: true,
      proxy: {
        "/api": { target: api, changeOrigin: false },
        "^/mcp/(crm|workspace)(?:[/?]|$)": { target: api, changeOrigin: false },
        "/rpc": { target: api, changeOrigin: false },
        "/v1": { target: api, changeOrigin: false },
      },
    },
    preview: {
      host: "0.0.0.0",
      port: Number(process.env.WEB_PORT ?? 5173),
      allowedHosts: [...new Set([previewHost, ...brandHostnames()])],
      proxy: {
        "/api": { target: api, changeOrigin: false },
        "^/mcp/(crm|workspace)(?:[/?]|$)": { target: api, changeOrigin: false },
        "/rpc": { target: api, changeOrigin: false },
        "/v1": { target: api, changeOrigin: false },
      },
    },
  };
});
