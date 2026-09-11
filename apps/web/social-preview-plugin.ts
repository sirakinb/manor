import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Plugin, PreviewServer, ViteDevServer } from "vite";
import { brands } from "../../packages/brands/src/index.ts";
import { renderSocialPreview } from "./src/social-preview";

export function socialPreviewPlugin(): Plugin {
  function attach(server: ViteDevServer | PreviewServer, development: boolean) {
    server.middlewares.use(async (req, res, next) => {
      const hostname = req.headers.host?.toLowerCase().split(":")[0];
      const brand = brands.find((candidate) => candidate.hostnames.includes(hostname ?? ""));
      const pathname = req.url?.split("?", 1)[0] ?? "/";
      if (
        !brand?.socialPreview ||
        !["GET", "HEAD"].includes(req.method ?? "") ||
        pathname.startsWith("/@") ||
        (req.headers["sec-fetch-dest"] &&
          !["document", "iframe", "empty"].includes(String(req.headers["sec-fetch-dest"]))) ||
        !/^(?:[^.]*|.*\.html)$/.test(pathname) ||
        /^\/(?:api|rpc|v1|mcp|novnc|preview)(?:\/|$)/.test(pathname) ||
        (req.headers.accept && !/text\/html|\*\/\*/.test(req.headers.accept))
      ) {
        next();
        return;
      }
      try {
        const root = development
          ? server.config.root
          : path.resolve(server.config.root, server.config.build.outDir);
        let html = await readFile(path.join(root, "index.html"), "utf8");
        if (development) {
          html = await (server as ViteDevServer).transformIndexHtml(req.url ?? "/", html);
        }
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache");
        res.end(req.method === "HEAD" ? undefined : renderSocialPreview(html, brand));
      } catch (error) {
        next(error);
      }
    });
  }
  return {
    name: "organization-social-preview",
    configureServer: (server) => attach(server, true),
    configurePreviewServer: (server) => attach(server, false),
  };
}
