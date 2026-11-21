import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createServer } from "node:net";
import {
  SCREEN_UNCONFIRMED_MAX_MS,
  sealScreenCapability,
} from "@rakazo/core/node/screen-capability";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScreenCheck } from "./screen-proxy.js";
import {
  checkScreenAuthorization,
  novncRequestPath,
  resolveNovncTarget,
  safeProxyHeaders,
  screenCapabilityExpiry,
  screenProbePath,
  screenProbeStatus,
  screenRefusal,
  screenUpstreamReachable,
  watchScreenAuthorization,
} from "./screen-proxy.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("screen proxy", () => {
  it("uses only server-provided provider credentials for both proxy transports", () => {
    expect(
      safeProxyHeaders(
        {
          cookie: "app_session=private",
          authorization: "Bearer browser",
          host: "app.example",
          upgrade: "websocket",
        },
        {
          protocol: "https:",
          hostname: "screen.example",
          port: 443,
          headers: { cookie: "provider_auth=fake-token" },
        },
      ),
    ).toEqual({ upgrade: "websocket", cookie: "provider_auth=fake-token" });
  });

  it("presents the provider's own origin so it accepts the proxied socket", () => {
    const headers = { origin: "https://app.example", upgrade: "websocket" };
    expect(
      safeProxyHeaders(headers, { protocol: "https:", hostname: "screen.example", port: 443 }),
    ).toEqual({ origin: "https://screen.example", upgrade: "websocket" });
    expect(
      safeProxyHeaders(headers, { protocol: "http:", hostname: "10.0.0.5", port: 6100 }),
    ).toEqual({ origin: "http://10.0.0.5:6100", upgrade: "websocket" });
  });

  it("routes the socket stock noVNC opens from a capability's path", () => {
    const screen = new URL(
      sealScreenCapability(
        "https://screen.example/vnc.html?path=websockify%3Ftoken%3Dfake-socket",
        "fake-secret",
        "https://app.example",
        {
          botId: "bot-1",
          computerId: "computer-1",
          botGeneration: 1,
          computerGeneration: 1,
          controlLeaseId: null,
        },
      ),
    );
    // noVNC 1.3 (Debian's package) joins host, "/" and the path setting.
    const socketPath = `/${screen.searchParams.get("path")}`;
    expect(socketPath.startsWith("//")).toBe(true);
    expect(novncRequestPath(socketPath)).toBe(screen.pathname.replace("/vnc.html", "/websockify"));
    expect(novncRequestPath("/novnc/session/view/token/vnc.html")).toBe(
      "/novnc/session/view/token/vnc.html",
    );
    expect(novncRequestPath("/rpc/computer.boot")).toBeNull();
  });

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
    const check = vi
      .fn<() => Promise<ScreenCheck>>()
      .mockResolvedValueOnce("allowed")
      .mockResolvedValueOnce("denied");
    const revoke = vi.fn();
    watchScreenAuthorization(check, revoke);
    await vi.advanceTimersByTimeAsync(1000);
    expect(revoke).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith("denied");
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
    expect(revoke).toHaveBeenCalledWith("denied");
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

const opened = {
  protocol: "http:" as const,
  hostname: "127.0.0.1",
  port: 49152,
  path: "/websockify",
  interactive: true,
};

/** Fake timers that also drive the monotonic clock the window is measured on. */
const fakeClock = () =>
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"],
  });

/** A recheck that takes `ms` to come back with `result`, like a slow authority. */
const slow = (ms: number, result: ScreenCheck) => () =>
  new Promise<ScreenCheck>((resolve) => setTimeout(() => resolve(result), ms));

describe("screen rechecks while the authority is slow or down", () => {
  it("keeps a stream open through a timed-out check that a yes follows", async () => {
    fakeClock();
    const results: (() => Promise<ScreenCheck>)[] = [
      slow(2000, "unavailable"),
      slow(10, "allowed"),
      slow(2000, "unavailable"),
      slow(10, "allowed"),
    ];
    const revoke = vi.fn();
    const onUnavailable = vi.fn();
    const stop = watchScreenAuthorization(() => results.shift()!(), revoke, { onUnavailable });
    await vi.advanceTimersByTimeAsync(8000);
    expect(revoke).not.toHaveBeenCalled();
    expect(onUnavailable).toHaveBeenCalledTimes(2);
    expect(onUnavailable).toHaveBeenLastCalledWith(1);
    stop();
  });

  it("ends a stream once no check has said yes for the window", async () => {
    fakeClock();
    const revoke = vi.fn();
    const onUnavailable = vi.fn();
    watchScreenAuthorization(slow(2000, "unavailable"), revoke, { onUnavailable });
    // Sent at 1 s (answered 3 s), 4 s (answered 6 s: 6 s since the stream's own yes).
    await vi.advanceTimersByTimeAsync(5999);
    expect(revoke).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(revoke).toHaveBeenCalledWith("unconfirmed_window");
    expect(onUnavailable).toHaveBeenCalledTimes(1);
  });

  it("rides out fast network errors for the window, then ends the stream", async () => {
    fakeClock();
    const revoke = vi.fn();
    const onUnavailable = vi.fn();
    watchScreenAuthorization(async () => "unavailable", revoke, { onUnavailable });
    await vi.advanceTimersByTimeAsync(SCREEN_UNCONFIRMED_MAX_MS - 1);
    expect(revoke).not.toHaveBeenCalled();
    expect(onUnavailable).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(1);
    expect(revoke).toHaveBeenCalledWith("unconfirmed_window");
  });

  it("measures the window from when the last yes was asked for, not when it came back", async () => {
    fakeClock();
    const results: (() => Promise<ScreenCheck>)[] = [
      // Sent at 1 s, answered yes at 2.9 s: the window runs from 1 s.
      slow(1900, "allowed"),
      async () => "unavailable",
      async () => "unavailable",
      async () => "unavailable",
      async () => "unavailable",
      async () => "unavailable",
      async () => "unavailable",
    ];
    const revoke = vi.fn();
    watchScreenAuthorization(() => results.shift()!(), revoke);
    // Six seconds after the yes was asked for (1 s), not after it came back (2.9 s).
    await vi.advanceTimersByTimeAsync(6999);
    expect(revoke).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(revoke).toHaveBeenCalledWith("unconfirmed_window");
  });

  it("starts the window again after a yes", async () => {
    fakeClock();
    const results: ScreenCheck[] = [
      "unavailable",
      "unavailable",
      "unavailable",
      "unavailable",
      "allowed",
      "unavailable",
      "unavailable",
      "unavailable",
      "unavailable",
      "unavailable",
    ];
    const revoke = vi.fn();
    const stop = watchScreenAuthorization(async () => results.shift()!, revoke);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(revoke).not.toHaveBeenCalled();
    stop();
  });

  it("ends a stream at once on a refusal, even inside the window", async () => {
    fakeClock();
    const results: ScreenCheck[] = ["unavailable", "denied"];
    const revoke = vi.fn();
    watchScreenAuthorization(async () => results.shift()!, revoke);
    await vi.advanceTimersByTimeAsync(2000);
    expect(revoke).toHaveBeenCalledWith("denied");
  });

  it("never lets an outage carry a stream past its capability's expiry", async () => {
    fakeClock();
    const revoke = vi.fn();
    watchScreenAuthorization(async () => "unavailable", revoke, {
      expiresAt: Date.now() + 2500,
    });
    await vi.advanceTimersByTimeAsync(2499);
    expect(revoke).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(revoke).toHaveBeenCalledWith("expired");
  });

  it("ends a stream on time when a slow check is still out at the window's end", async () => {
    fakeClock();
    const latencies = [10, 10, 10, 10, 959, 1999];
    let sent = 0;
    const revoke = vi.fn();
    watchScreenAuthorization(
      () => slow(latencies[Math.min(sent++, latencies.length - 1)]!, "unavailable")(),
      revoke,
    );
    await vi.advanceTimersByTimeAsync(5999);
    expect(revoke).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(revoke).toHaveBeenCalledWith("unconfirmed_window");
  });

  it("ends a stream whose check never comes back", async () => {
    fakeClock();
    const revoke = vi.fn();
    watchScreenAuthorization(() => new Promise<ScreenCheck>(() => undefined), revoke);
    await vi.advanceTimersByTimeAsync(6000);
    expect(revoke).toHaveBeenCalledWith("unconfirmed_window");
  });

  it("ends a stream that is still allowed once its capability expires", async () => {
    fakeClock();
    const revoke = vi.fn();
    watchScreenAuthorization(async () => "allowed", revoke, { expiresAt: Date.now() + 2500 });
    await vi.advanceTimersByTimeAsync(2500);
    expect(revoke).toHaveBeenCalledWith("expired");
  });

  it("isn't stretched by the wall clock moving back", async () => {
    fakeClock();
    let checks = 0;
    const revoke = vi.fn();
    watchScreenAuthorization(async () => {
      checks += 1;
      if (checks === 2) vi.setSystemTime(Date.now() - 30_000);
      return "unavailable";
    }, revoke);
    await vi.advanceTimersByTimeAsync(6000);
    expect(revoke).toHaveBeenCalledWith("unconfirmed_window");
    expect(checks).toBe(5);
  });

  it("never runs two checks at once", async () => {
    fakeClock();
    let running = 0;
    let most = 0;
    const revoke = vi.fn();
    const stop = watchScreenAuthorization(async () => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 2500));
      running -= 1;
      return "allowed";
    }, revoke);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(most).toBe(1);
    stop();
  });
});

describe("what a recheck of an open screen counts as", () => {
  const recheck = (response: Response | Error) => {
    vi.stubGlobal(
      "fetch",
      response instanceof Error
        ? vi.fn().mockRejectedValue(response)
        : vi.fn().mockResolvedValue(response),
    );
    return checkScreenAuthorization(
      "/novnc/session/control/1.token/websockify",
      "secret",
      "http://api.example",
      opened,
    );
  };

  it("is a yes only for the same target the stream opened with", async () => {
    expect(await recheck(Response.json(opened))).toBe("allowed");
    expect(await recheck(Response.json({ ...opened, port: 49153 }))).toBe("denied");
    expect(await recheck(Response.json({ ...opened, interactive: false }))).toBe("denied");
    expect(await recheck(Response.json({ ...opened, hostname: "10.0.0.9" }))).toBe("denied");
    expect(await recheck(Response.json({ ...opened, path: "/other" }))).toBe("denied");
  });

  it("counts the authority's refusals, and any answer it can't vouch for, as a no", async () => {
    for (const status of [400, 401, 403, 404, 413]) {
      expect(await recheck(new Response(null, { status }))).toBe("denied");
    }
    expect(await recheck(new Response("<html>sign in</html>", { status: 200 }))).toBe("denied");
    expect(await recheck(Response.json({ hostname: "screen.example" }))).toBe("denied");
  });

  it("counts timeouts, dropped connections, server errors and rate limits as unavailable", async () => {
    for (const status of [500, 502, 503, 504, 408, 429]) {
      expect(await recheck(new Response(null, { status }))).toBe("unavailable");
    }
    expect(await recheck(new DOMException("The operation timed out.", "TimeoutError"))).toBe(
      "unavailable",
    );
    expect(await recheck(new TypeError("fetch failed"))).toBe("unavailable");
  });
});

describe("screen capability expiry", () => {
  it("reads the expiry the capability was sealed with", () => {
    expect(screenCapabilityExpiry("/novnc/session/control/1761400000000.abc/websockify")).toBe(
      1761400000000,
    );
    expect(screenCapabilityExpiry("/novnc/session/view/123.abc/vnc.html")).toBe(123);
    expect(screenCapabilityExpiry("/novnc/old/view/token")).toBeUndefined();
    expect(screenCapabilityExpiry(undefined)).toBeUndefined();
  });
});

describe("refusing a screen that wasn't let through", () => {
  it("says unavailable only when the API couldn't be asked, and 403 for every judgement", () => {
    expect(screenRefusal("authority_unavailable")).toEqual({
      status: 503,
      body: "Screen unavailable",
    });
    for (const reason of [
      "authority_rejected",
      "invalid_authority_response",
      "invalid_path",
      undefined,
    ] as const) {
      expect(screenRefusal(reason)).toEqual({
        status: 403,
        body: "Invalid or expired screen capability",
      });
    }
  });
});

describe("the status-only probe", () => {
  it("is recognised only by its exact mark, and checks the same screen URL without it", () => {
    expect(
      screenProbePath("/novnc/session/view/1.t/vnc.html?autoconnect=true&rakazo_probe=1"),
    ).toBe("/novnc/session/view/1.t/vnc.html?autoconnect=true");
    expect(screenProbePath("/novnc/session/view/1.t/vnc.html?rakazo_probe=1")).toBe(
      "/novnc/session/view/1.t/vnc.html",
    );
    expect(screenProbePath("/novnc/session/view/1.t/vnc.html?autoconnect=true")).toBeNull();
    expect(screenProbePath("/novnc/session/view/1.t/vnc.html?rakazo_probe=yes")).toBeNull();
    expect(screenProbePath("/novnc/session/view/1.t/vnc.html?xrakazo_probe=1")).toBeNull();
    expect(screenProbePath(undefined)).toBeNull();
  });

  it("removes only the mark, leaving the rest of the URL exactly as sent", () => {
    expect(
      screenProbePath("/novnc/session/view/1.t/vnc.html?path=a%2Fb&rakazo_probe=1&x=%20y"),
    ).toBe("/novnc/session/view/1.t/vnc.html?path=a%2Fb&x=%20y");
    expect(screenProbePath("/novnc/session/view/1.t/vnc.html?rakazo_probe=1&a=b+c")).toBe(
      "/novnc/session/view/1.t/vnc.html?a=b+c",
    );
  });

  it("answers with a status only: let through, refused, or the API couldn't be asked", () => {
    expect(screenProbeStatus(opened, undefined)).toBe(204);
    expect(screenProbeStatus(null, "authority_unavailable")).toBe(503);
    expect(screenProbeStatus(null, "authority_rejected")).toBe(403);
    expect(screenProbeStatus(null, "invalid_path")).toBe(403);
    expect(screenProbeStatus(opened, undefined, false)).toBe(502);
    expect(screenProbeStatus(null, "authority_rejected", false)).toBe(403);
  });

  it("tells whether the computer's screen takes connections, without sending it anything", async () => {
    let received = 0;
    const server = createServer((socket) => {
      socket.on("data", () => {
        received += 1;
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const at = (screenPort: number) => ({ ...opened, hostname: "127.0.0.1", port: screenPort });
    expect(await screenUpstreamReachable(at(port))).toBe(true);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(await screenUpstreamReachable(at(port))).toBe(false);
    expect(received).toBe(0);
  });
});
