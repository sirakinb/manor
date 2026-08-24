import { describe, expect, it } from "vitest";
import {
  canReleaseScreenLease,
  canTakeScreenLease,
  parseScreenLeaseId,
  screenLeaseId,
} from "./screen-lease.js";

describe("screenLeaseId", () => {
  it("puts the fence after the run id, including boot ids that contain a colon", () => {
    expect(screenLeaseId("run-1", 8)).toBe("run-1:8");
    expect(screenLeaseId("boot:abc", 3)).toBe("boot:abc:3");
    expect(parseScreenLeaseId("boot:abc:3")).toEqual({ ownerId: "boot:abc", fence: 3 });
    expect(parseScreenLeaseId("run-1")).toEqual({ ownerId: "run-1", fence: 0 });
  });
});

describe("canTakeScreenLease", () => {
  it("lets a newer fence reclaim the same run's screen", () => {
    expect(canTakeScreenLease("run-1:1", "run-1:8")).toBe(true);
  });

  it("hands the screen to a different run whatever its fence", () => {
    // Every fresh run starts at fence 1, so a fence comparison across runs would
    // leave the screen wedged behind a finished one until the supervisor restarted.
    expect(canTakeScreenLease("run-1:1", "run-2:1")).toBe(true);
    expect(canTakeScreenLease("run-2:2", "run-1:1")).toBe(true);
  });

  it("rejects a delayed request from an older fence of the same run", () => {
    expect(canTakeScreenLease("run-1:8", "run-1:1")).toBe(false);
    expect(canTakeScreenLease("run-2:2", undefined)).toBe(false);
  });
});

describe("canReleaseScreenLease", () => {
  it("lets the same run release after a takeover fence bump", () => {
    expect(canReleaseScreenLease("run-1:1", "run-1:8")).toBe(true);
    expect(canReleaseScreenLease("run-1:1", "run-1:1")).toBe(true);
  });

  it("rejects a stale finalizer after a newer run reclaimed the screen", () => {
    expect(canReleaseScreenLease("run-2:2", "run-1:1")).toBe(false);
  });
});
