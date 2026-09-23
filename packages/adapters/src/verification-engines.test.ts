import { describe, expect, it } from "vitest";
import {
  JEV_ENGINE,
  jevVerifierFromEnv,
  LLM_ENGINE,
  planVerificationEngines,
} from "./verification-engines.js";

const both = { [LLM_ENGINE]: true, [JEV_ENGINE]: true };

describe("planVerificationEngines", () => {
  it("uses the selected engine and shadows the other only when comparing", () => {
    expect(
      planVerificationEngines({ selected: JEV_ENGINE, compare: false, available: both }),
    ).toEqual({ primary: JEV_ENGINE, shadow: undefined });
    expect(
      planVerificationEngines({ selected: JEV_ENGINE, compare: true, available: both }),
    ).toEqual({
      primary: JEV_ENGINE,
      shadow: LLM_ENGINE,
    });
  });

  it("falls back when the selected engine is unavailable", () => {
    expect(
      planVerificationEngines({
        selected: JEV_ENGINE,
        compare: true,
        available: { [LLM_ENGINE]: true, [JEV_ENGINE]: false },
      }),
    ).toEqual({ primary: LLM_ENGINE });
    expect(
      planVerificationEngines({
        selected: LLM_ENGINE,
        compare: true,
        available: { [LLM_ENGINE]: false, [JEV_ENGINE]: false },
      }),
    ).toEqual({});
  });
});

describe("jevVerifierFromEnv", () => {
  it("is off without a key", () => {
    expect(jevVerifierFromEnv({})).toBeNull();
    expect(jevVerifierFromEnv({ TYPESAFE_API_KEY: " " })).toBeNull();
  });

  it("is on with a key", () => {
    expect(jevVerifierFromEnv({ TYPESAFE_API_KEY: "fake-typesafe-key" })?.describe().id).toBe(
      JEV_ENGINE,
    );
  });
});
