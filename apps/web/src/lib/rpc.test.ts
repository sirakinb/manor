import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearSpaceSelection,
  initialMe,
  recoverInitialSpace,
  selectedSpaceId,
  selectSpace,
} from "./rpc.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("initial space recovery", () => {
  function fixture() {
    let stored: string | null = "client-space";
    const localStorage = {
      getItem: () => stored,
      setItem: (_key: string, value: string) => {
        stored = value;
      },
      removeItem: () => {
        stored = null;
      },
    };
    vi.stubGlobal("window", { localStorage, location: { origin: "http://localhost" } });
    const fetch = vi.fn().mockResolvedValue(Response.json({ json: { spaceId: "main-space" } }));
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }

  it("reopens the main organization after an unauthorized saved selection", async () => {
    const fetch = fixture();
    const error = Object.assign(new Error("Unauthorized"), { code: "UNAUTHORIZED" });
    await expect(recoverInitialSpace(error, "client-space")).resolves.toMatchObject({
      spaceId: "main-space",
    });
    expect(selectedSpaceId()).toBe("main-space");
    expect(fetch.mock.calls[0]![1].headers.has("x-rakazo-space-id")).toBe(false);
  });

  it("does not change the selection for network failures or a newer user selection", async () => {
    const fetch = fixture();
    const network = new Error("Offline");
    await expect(recoverInitialSpace(network, "client-space")).rejects.toBe(network);
    const unauthorized = Object.assign(new Error("Unauthorized"), { code: "UNAUTHORIZED" });
    selectSpace("another-space");
    await expect(recoverInitialSpace(unauthorized, "client-space")).rejects.toBe(unauthorized);
    expect(fetch).not.toHaveBeenCalled();
    expect(selectedSpaceId()).toBe("another-space");
  });

  it("uses the selected space when it is still authorized", async () => {
    const fetch = fixture();
    await initialMe();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![1].headers.get("x-rakazo-space-id")).toBe("client-space");
    expect(selectedSpaceId()).toBe("client-space");
  });
});

describe("space selection storage", () => {
  it("reports localStorage write failures without throwing", () => {
    const localStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota exceeded");
      },
      removeItem: () => {
        throw new Error("quota exceeded");
      },
    };
    vi.stubGlobal("window", { localStorage });
    vi.stubGlobal("localStorage", localStorage);

    expect(selectSpace("space-support")).toBe(false);
    expect(() => clearSpaceSelection()).not.toThrow();
    expect(selectedSpaceId()).toBeNull();
  });

  it("treats an already-persisted selection as success when writes fail", () => {
    const localStorage = {
      getItem: (key: string) => (key === "rakazo:space-id" ? "space-support" : null),
      setItem: () => {
        throw new Error("quota exceeded");
      },
      removeItem: vi.fn(),
    };
    vi.stubGlobal("window", { localStorage });
    vi.stubGlobal("localStorage", localStorage);

    expect(selectSpace("space-support")).toBe(true);
    expect(selectSpace("space-other")).toBe(false);
  });

  it("reports when a space selection was persisted", () => {
    const setItem = vi.fn();
    const localStorage = { getItem: () => null, setItem, removeItem: vi.fn() };
    vi.stubGlobal("window", { localStorage });
    vi.stubGlobal("localStorage", localStorage);

    expect(selectSpace("space-support")).toBe(true);
    expect(setItem).toHaveBeenCalledWith("rakazo:space-id", "space-support");
  });
});
