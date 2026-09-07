// Synthetic release rehearsal only. No production routes, credentials or data.

import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

const marker = () => readFileSync(new URL("./revision.txt", import.meta.url), "utf8").trim();
const token = process.env.PREVIEW_TOKEN;
if (!token || token.length < 32) throw new Error("Private preview token required");
createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(marker() === "unhealthy" ? 503 : 200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: marker() !== "unhealthy" }));
  }
  const actual = Buffer.from(req.headers.authorization ?? "");
  const expected = Buffer.from("Bearer " + token);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    res.writeHead(401);
    return res.end("Authentication required");
  }
  res.writeHead(200, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
  res.end("Manor remote release rehearsal: " + marker() + "\n");
}).listen(Number(process.env.PORT ?? 5173), "0.0.0.0");
