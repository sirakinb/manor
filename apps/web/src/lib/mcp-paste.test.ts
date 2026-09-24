import { describe, expect, it } from "vitest";
import { parsePastedCallback } from "./mcp-paste";

describe("parsePastedCallback", () => {
  it("reads the code from the address the browser landed on", () => {
    expect(
      parsePastedCallback(
        "session-1",
        "  http://127.0.0.1:53682/mcp/oauth/callback?code=abc&state=session-1 ",
      ),
    ).toEqual({ ok: true, code: "abc", state: "session-1" });
  });

  it("refuses provider errors, other sign-ins, and text that is not an address", () => {
    expect(
      parsePastedCallback(
        "session-1",
        "http://127.0.0.1:53682/cb?error=access_denied&error_description=Denied",
      ),
    ).toEqual({ ok: false, reason: "denied", detail: "Denied" });
    expect(
      parsePastedCallback("session-1", "http://127.0.0.1:53682/cb?code=abc&state=other"),
    ).toEqual({ ok: false, reason: "other_sign_in" });
    expect(parsePastedCallback("session-1", "not a url")).toEqual({
      ok: false,
      reason: "not_an_address",
    });
  });
});
