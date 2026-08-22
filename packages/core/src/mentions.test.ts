import { describe, expect, it } from "vitest";
import {
  botHopsSinceHumanTurn,
  decideMentions,
  MAX_BOT_HOPS_PER_TURN,
  parseMentions,
} from "./mentions.js";

const scout = { id: "b-scout", name: "Scout" };
const quill = { id: "b-quill", name: "Quill" };
const chief = { id: "b-chief", name: "Chief Of Staff Agent" };
const research = { id: "b-research", name: "Research Agent" };
const room = [scout, quill, chief, research];

describe("parseMentions", () => {
  it("finds a mention", () => {
    expect(parseMentions("@Scout can you look into this", room)).toEqual(["b-scout"]);
  });

  it("keeps the order they appear and drops repeats", () => {
    expect(parseMentions("@Quill after @Scout finishes, and @Quill again", room)).toEqual([
      "b-quill",
      "b-scout",
    ]);
  });

  it("handles names containing spaces", () => {
    expect(parseMentions("@Chief Of Staff Agent please coordinate", room)).toEqual(["b-chief"]);
  });

  it("prefers the longer name when one contains another", () => {
    // "@Research Agent" must not be read as a mention of a bot called "Research".
    const withShort = [...room, { id: "b-short", name: "Research" }];
    expect(parseMentions("@Research Agent take this", withShort)).toEqual(["b-research"]);
  });

  it("requires a boundary after the name", () => {
    expect(parseMentions("@Scouting is not @Scout", room)).toEqual(["b-scout"]);
  });

  it("ignores names that are not in the room", () => {
    expect(parseMentions("@Nobody hello", room)).toEqual([]);
  });

  it("is case insensitive", () => {
    expect(parseMentions("@scout and @QUILL", room)).toEqual(["b-scout", "b-quill"]);
  });

  it("returns nothing for text with no mentions", () => {
    expect(parseMentions("just a normal sentence", room)).toEqual([]);
  });
});

describe("botHopsSinceHumanTurn", () => {
  it("counts bot messages since the last human turn", () => {
    expect(
      botHopsSinceHumanTurn([
        { role: "user" },
        { role: "bot", authorBotId: "b-scout" },
        { role: "bot", authorBotId: "b-quill" },
      ]),
    ).toBe(2);
  });

  it("resets when a person speaks", () => {
    expect(
      botHopsSinceHumanTurn([
        { role: "bot", authorBotId: "b-scout" },
        { role: "bot", authorBotId: "b-quill" },
        { role: "user" },
      ]),
    ).toBe(0);
  });

  it("ignores messages with no bot author", () => {
    expect(botHopsSinceHumanTurn([{ role: "user" }, { role: "bot" }, { role: "system" }])).toBe(0);
  });
});

describe("decideMentions", () => {
  const base = {
    participants: room,
    hopsSinceHumanTurn: 0,
    botsAlreadyRunning: [] as string[],
  };

  it("wakes the mentioned bots", () => {
    const decision = decideMentions({
      ...base,
      mentioned: ["b-scout", "b-quill"],
      authoredByBot: false,
    });
    expect(decision.wake).toEqual(["b-scout", "b-quill"]);
    expect(decision.refused).toEqual([]);
  });

  it("stops a bot-to-bot chain at the hop limit", () => {
    const decision = decideMentions({
      ...base,
      mentioned: ["b-scout"],
      authoredByBot: true,
      hopsSinceHumanTurn: MAX_BOT_HOPS_PER_TURN,
    });
    expect(decision.wake).toEqual([]);
    expect(decision.refused).toEqual([{ botId: "b-scout", reason: "hop_limit" }]);
  });

  it("never applies the hop limit to a person", () => {
    // A long-running room must still answer its owner.
    const decision = decideMentions({
      ...base,
      mentioned: ["b-scout"],
      authoredByBot: false,
      hopsSinceHumanTurn: MAX_BOT_HOPS_PER_TURN * 5,
    });
    expect(decision.wake).toEqual(["b-scout"]);
  });

  it("counts the wakes it is about to make toward the limit", () => {
    const decision = decideMentions({
      ...base,
      mentioned: ["b-scout", "b-quill", "b-chief"],
      authoredByBot: true,
      hopsSinceHumanTurn: MAX_BOT_HOPS_PER_TURN - 2,
    });
    expect(decision.wake).toEqual(["b-scout", "b-quill"]);
    expect(decision.refused).toEqual([{ botId: "b-chief", reason: "hop_limit" }]);
  });

  it("will not interrupt a bot that is already running", () => {
    const decision = decideMentions({
      ...base,
      mentioned: ["b-scout"],
      authoredByBot: true,
      botsAlreadyRunning: ["b-scout"],
    });
    expect(decision.refused).toEqual([{ botId: "b-scout", reason: "already_running" }]);
  });

  it("refuses a bot that is not in the room", () => {
    const decision = decideMentions({
      ...base,
      mentioned: ["b-outsider"],
      authoredByBot: false,
    });
    expect(decision.refused).toEqual([{ botId: "b-outsider", reason: "not_a_participant" }]);
  });

  it("two bots mentioning each other cannot run away", () => {
    // Simulate the ping-pong: each hop increments, and the chain dies at the cap.
    let hops = 0;
    let wakes = 0;
    for (let round = 0; round < 50; round += 1) {
      const decision = decideMentions({
        ...base,
        mentioned: [round % 2 === 0 ? "b-quill" : "b-scout"],
        authoredByBot: true,
        hopsSinceHumanTurn: hops,
      });
      if (decision.wake.length === 0) break;
      wakes += decision.wake.length;
      hops += 1;
    }
    expect(wakes).toBe(MAX_BOT_HOPS_PER_TURN);
  });
});
