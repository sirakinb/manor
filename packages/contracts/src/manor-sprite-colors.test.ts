import { describe, expect, it } from "vitest";
import { drawsManorSprite } from "./manor-sprite-colors.js";

describe("drawsManorSprite", () => {
  it("is true for a plain sprite colour in any case, including upstream's brighter violet", () => {
    expect(drawsManorSprite("#8B5CF6")).toBe(true);
    expect(drawsManorSprite("#a97efe")).toBe(true);
  });

  it("is false for other colours, chosen shapes and uploaded images", () => {
    expect(drawsManorSprite("#00C972")).toBe(false);
    expect(drawsManorSprite("#8B5CF6::shape_1")).toBe(false);
    expect(drawsManorSprite("data:image/png;base64,AAAA")).toBe(false);
  });
});
