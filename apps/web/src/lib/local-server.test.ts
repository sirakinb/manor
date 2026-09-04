import { describe, expect, it } from "vitest";
import { isLocalServer } from "./local-server.js";

describe("isLocalServer", () => {
  it("accepts loopback addresses where the API runs on this machine", () => {
    expect(isLocalServer("localhost")).toBe(true);
    expect(isLocalServer("127.0.0.1")).toBe(true);
    expect(isLocalServer("[::1]")).toBe(true);
    expect(isLocalServer("dev.localhost")).toBe(true);
  });

  it('rejects hosted servers, where "this Mac" would mean the VPS', () => {
    expect(isLocalServer("manor.pentridgemedia.com")).toBe(false);
    expect(isLocalServer("jrhmanor.agentworkspace.cloud")).toBe(false);
    expect(isLocalServer("192.168.1.20")).toBe(false);
  });
});
