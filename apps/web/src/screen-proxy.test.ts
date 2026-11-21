import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveNovncTarget, safeProxyHeaders, watchScreenAuthorization } from "./screen-proxy.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("screen proxy", () => {
  it("rejects legacy URLs without contacting the API", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(
      await resolveNovncTarget("/novnc/old/view/token/embed.html", "secret", "http://api.example"),
    ).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("checks each request and fails closed on revocation or API failure", async () => {
    const target = {
      protocol: "http:",
      hostname: "127.0.0.1",
      port: 49152,
      path: "/websockify",
      interactive: false,
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(target))
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetch);
    const failures: string[] = [];
    const resolve = () =>
      resolveNovncTarget(
        "/novnc/session/view/token/websockify",
        "secret",
        "http://api.example",
        (reason) => failures.push(reason),
      );
    expect(await resolve()).toEqual(target);
    expect(await resolve()).toBeNull();
    expect(await resolve()).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(failures).toEqual(["authority_rejected", "authority_unavailable"]);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      redirect: "error",
      headers: { authorization: "Bearer secret" },
    });
  });
  it("fails closed for a malformed authority response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ hostname: "screen.example", port: "443" })),
    );
    const onFailure = vi.fn();
    expect(
      await resolveNovncTarget(
        "/novnc/session/view/token/vnc.html",
        "secret",
        "http://api.example",
        onFailure,
      ),
    ).toBeNull();
    expect(onFailure).toHaveBeenCalledWith("invalid_authority_response");
  });
  it("reports invalid JSON as an invalid authority response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not-json", { status: 200 })));
    const onFailure = vi.fn();
    expect(
      await resolveNovncTarget(
        "/novnc/session/view/token/vnc.html",
        "secret",
        "http://api.example",
        onFailure,
      ),
    ).toBeNull();
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledWith("invalid_authority_response");
  });
  it("reports a dropped authority body as unavailable", async () => {
    const response = new Response("{}", { status: 200 });
    vi.spyOn(response, "json").mockRejectedValueOnce(new Error("aborted"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const onFailure = vi.fn();
    expect(
      await resolveNovncTarget(
        "/novnc/session/view/token/vnc.html",
        "secret",
        "http://api.example",
        onFailure,
      ),
    ).toBeNull();
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledWith("authority_unavailable");
  });

  it("closes an active stream on revocation and stops checking closed streams", async () => {
    vi.useFakeTimers();
    const check = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const revoke = vi.fn();
    watchScreenAuthorization(check, revoke);
    await vi.advanceTimersByTimeAsync(1000);
    expect(revoke).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(revoke).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(check).toHaveBeenCalledTimes(2);
    const stop = watchScreenAuthorization(check, revoke);
    stop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(check).toHaveBeenCalledTimes(2);
  });
  it("closes a stream when authorization fails unexpectedly", async () => {
    vi.useFakeTimers();
    const revoke = vi.fn();
    watchScreenAuthorization(async () => {
      throw new Error("unavailable");
    }, revoke);
    await vi.advanceTimersByTimeAsync(1000);
    expect(revoke).toHaveBeenCalledTimes(1);
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

  it("does not forward HTTP/2 pseudo-headers to the HTTP/1 upstream", () => {
    expect(
      safeProxyHeaders({
        ":method": "GET",
        ":path": "/novnc/embed.html",
        ":authority": "localhost:5173",
        ":scheme": "https",
        upgrade: "websocket",
        "sec-websocket-key": "key",
      }),
    ).toEqual({ upgrade: "websocket", "sec-websocket-key": "key" });
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
