import { createCipheriv, createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  resolveNovncTarget,
  safeProxyHeaders,
  safeProxyResponseHeaders,
  stripSensitiveHandshakeHeaders,
} from "./screen-proxy.js";

function signedPath(
  port: number,
  expiresAt: number,
  secret: string,
  rest = "/embed.html",
  hostname = "127.0.0.1",
  policy: "view" | "control" = "view",
) {
  const signature = createHmac("sha256", secret)
    .update(`${hostname}:${port}:${policy}:${expiresAt}`)
    .digest("base64url");
  const target = Buffer.from(hostname).toString("base64url");
  return `/novnc/${target}/${port}/${policy}/${expiresAt}.${signature}${rest}`;
}

function remotePath(
  expiresAt: number,
  secret: string,
  url: string,
  policy: "view" | "control" = "view",
) {
  const iv = Buffer.alloc(12, 1);
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), iv);
  cipher.setAAD(Buffer.from(`${policy}:${expiresAt}`));
  const ciphertext = Buffer.concat([cipher.update(url, "utf8"), cipher.final()]);
  const token = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
  return `/novnc/remote/${policy}/${expiresAt}.${token}/vnc.html`;
}

describe("noVNC proxy authorization", () => {
  it("accepts signed, unexpired loopback targets", () => {
    expect(resolveNovncTarget(signedPath(49152, 2_000, "secret"), "secret", 1_000)).toEqual({
      hostname: "127.0.0.1",
      port: 49152,
      path: "/embed.html?view_only=true",
      interactive: false,
    });
  });

  it("rejects arbitrary ports, bad signatures, and expired capabilities", () => {
    expect(resolveNovncTarget("/novnc/5432/index.html", "secret", 1_000)).toBeNull();
    expect(resolveNovncTarget(signedPath(49152, 2_000, "wrong"), "secret", 1_000)).toBeNull();
    expect(resolveNovncTarget(signedPath(49152, 999, "secret"), "secret", 1_000)).toBeNull();
  });

  it("binds server-enforced view mode while allowing required noVNC paths", () => {
    const viewOnly = signedPath(49152, 2_000, "secret", "/embed.html?view_only=true");
    expect(resolveNovncTarget(viewOnly, "secret", 1_000)?.path).toBe("/embed.html?view_only=true");
    expect(
      resolveNovncTarget(viewOnly.replace("view_only=true", "view_only=false"), "secret", 1_000),
    ).toMatchObject({ path: "/embed.html?view_only=true", interactive: false });
    expect(
      resolveNovncTarget(
        viewOnly.replace(/\/embed\.html\?view_only=true$/, "/websockify"),
        "secret",
        1_000,
      ),
    ).toMatchObject({ path: "/websockify", interactive: false });
    expect(resolveNovncTarget(viewOnly.replace("/view/", "/control/"), "secret", 1_000)).toBeNull();
    expect(resolveNovncTarget(viewOnly.replace("/49152/", "/49153/"), "secret", 1_000)).toBeNull();

    const control = signedPath(
      49153,
      2_000,
      "secret",
      "/embed.html?view_only=true",
      "127.0.0.1",
      "control",
    );
    expect(resolveNovncTarget(control, "secret", 1_000)).toMatchObject({
      path: "/embed.html?view_only=false",
      interactive: true,
    });
  });

  it("keeps encrypted external Box targets bound to their view/control policy", () => {
    const target = "https://box.example/vnc.html?token=provider-secret&view_only=true";
    const view = remotePath(2_000, "secret", target);
    expect(resolveNovncTarget(view, "secret", 1_000)).toMatchObject({
      protocol: "https:",
      hostname: "box.example",
      port: 443,
      path: "/vnc.html?token=provider-secret&view_only=true",
      interactive: false,
    });
    expect(
      resolveNovncTarget(view.replace("/vnc.html", "/vnc.html?view_only=false"), "secret", 1_000),
    ).toMatchObject({
      path: "/vnc.html?token=provider-secret&view_only=true",
      interactive: false,
    });
    expect(resolveNovncTarget(view.replace("/view/", "/control/"), "secret", 1_000)).toBeNull();
  });

  it("does not forward application credentials", () => {
    expect(
      safeProxyHeaders({
        host: "app.example",
        cookie: "session=secret",
        authorization: "Bearer secret",
        "proxy-authorization": "Basic secret",
        upgrade: "websocket",
        "sec-websocket-key": "key",
      }),
    ).toEqual({ upgrade: "websocket", "sec-websocket-key": "key" });
  });

  it("does not accept cookie or site-data mutations from a bot computer", () => {
    expect(
      safeProxyResponseHeaders({
        "content-type": "text/html",
        "set-cookie": ["session=attacker"],
        "clear-site-data": '"cookies"',
      }),
    ).toEqual({ "content-type": "text/html" });

    const handshake = Buffer.from(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nSet-Cookie: session=attacker\r\n\r\nframe",
      "latin1",
    );
    expect(stripSensitiveHandshakeHeaders(handshake)?.toString("latin1")).toBe(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n\r\nframe",
    );
  });
});

describe("preview proxy", () => {
  const secret = "preview-secret";
  const now = 1_700_000_000_000;
  function previewPath(port: number, expiresAt: number, rest = "/", hostname = "172.31.240.23") {
    const signature = createHmac("sha256", secret)
      .update(`${hostname}:${port}:app:${expiresAt}`)
      .digest("base64url");
    const target = Buffer.from(hostname).toString("base64url");
    return `/preview/${target}/${port}/${expiresAt}.${signature}${rest}`;
  }

  it("resolves a signed app capability and exposes its prefix", async () => {
    const { resolvePreviewTarget } = await import("./screen-proxy.js");
    const url = previewPath(3000, now + 60_000, "/dashboard?tab=1");
    const target = resolvePreviewTarget(url, secret, now);
    expect(target).toMatchObject({
      hostname: "172.31.240.23",
      port: 3000,
      path: "/dashboard?tab=1",
    });
    expect(target?.prefix).toBe(url.slice(0, url.indexOf("/dashboard")));
  });

  it("rejects expired, tampered, and screen-policy capabilities", async () => {
    const { resolvePreviewTarget } = await import("./screen-proxy.js");
    expect(resolvePreviewTarget(previewPath(3000, now - 1), secret, now)).toBeNull();
    expect(resolvePreviewTarget(previewPath(3000, now + 60_000), "other", now)).toBeNull();
    const screenSigned = previewPath(3000, now + 60_000).replace(/\/preview\//, "/novnc/");
    expect(resolvePreviewTarget(screenSigned, secret, now)).toBeNull();
    // A screen capability (policy "view") must not validate as an app capability.
    const viewSig = createHmac("sha256", secret)
      .update(`172.31.240.23:3000:view:${now + 60_000}`)
      .digest("base64url");
    const host = Buffer.from("172.31.240.23").toString("base64url");
    expect(
      resolvePreviewTarget(`/preview/${host}/3000/${now + 60_000}.${viewSig}/`, secret, now),
    ).toBeNull();
  });

  it("refuses hosts outside the sandbox networks", async () => {
    const { resolvePreviewTarget } = await import("./screen-proxy.js");
    expect(
      resolvePreviewTarget(previewPath(3000, now + 60_000, "/", "example.com"), secret, now),
    ).toBeNull();
  });

  it("rewrites absolute asset paths in HTML and CSS under the prefix", async () => {
    const { rewritePreviewCss, rewritePreviewHtml } = await import("./screen-proxy.js");
    const prefix = "/preview/abc/3000/1.sig";
    const html = rewritePreviewHtml(
      '<html><head><link href="/style.css"><script src="/app.js"></script></head>' +
        '<body><img src="./rel.png"><img srcset="/a.png 1x, /b.png 2x"><a href="//cdn.example/x">x</a>' +
        '<form action="/submit"></form></body></html>',
      prefix,
    );
    expect(html).toContain(`<head><base href="${prefix}/">`);
    expect(html).toContain(`href="${prefix}/style.css"`);
    expect(html).toContain(`src="${prefix}/app.js"`);
    expect(html).toContain(`action="${prefix}/submit"`);
    expect(html).toContain(`srcset="${prefix}/a.png 1x, ${prefix}/b.png 2x"`);
    expect(html).toContain('src="./rel.png"');
    expect(html).toContain('href="//cdn.example/x"');
    expect(
      rewritePreviewCss("a{background:url(/img.png)} b{background:url('/x.png')}", prefix),
    ).toBe(`a{background:url(${prefix}/img.png)} b{background:url('${prefix}/x.png')}`);
  });

  it("does not add a second <base>", async () => {
    const { rewritePreviewHtml } = await import("./screen-proxy.js");
    const out = rewritePreviewHtml('<head><base href="/x/"></head>', "/preview/p");
    expect(out.match(/<base/g)?.length).toBe(1);
  });
});
