import { afterEach, describe, expect, it } from "vitest";
import { computerNetworkNameFor } from "./computer-spec.js";
import { pinnedComputerNetwork } from "./manor-computer-network.js";
import { computerNetworkName } from "./networks.js";

const saved = process.env.RAKAZO_COMPUTER_NETWORK;

describe("Manor's pinned computer network", () => {
  afterEach(() => {
    if (saved === undefined) delete process.env.RAKAZO_COMPUTER_NETWORK;
    else process.env.RAKAZO_COMPUTER_NETWORK = saved;
  });

  it("puts every bot's computer on the pinned network", () => {
    process.env.RAKAZO_COMPUTER_NETWORK = " manor-prod_screens ";
    expect(pinnedComputerNetwork()).toBe("manor-prod_screens");
    expect(computerNetworkName("bot_1", undefined)).toBe("manor-prod_screens");
    expect(computerNetworkName("bot_2", undefined)).toBe("manor-prod_screens");
  });

  it("falls back to the per-bot network when unset or blank", () => {
    process.env.RAKAZO_COMPUTER_NETWORK = "  ";
    expect(pinnedComputerNetwork()).toBeUndefined();
    delete process.env.RAKAZO_COMPUTER_NETWORK;
    expect(computerNetworkName("bot_1", undefined)).toBe(computerNetworkNameFor("bot_1"));
  });
});
