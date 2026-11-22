import { describe, expect, it } from "vitest";
import {
  applyResolvedAppearance,
  applyUiAppearance,
  PINNED_APPEARANCE,
  readSystemAppearance,
} from "./ui-appearance";

describe("ui-appearance", () => {
  it("treats matching light media as light", () => {
    expect(readSystemAppearance({ matches: true })).toBe("light");
    expect(readSystemAppearance({ matches: false })).toBe("dark");
  });

  it("writes data-theme and color-scheme on the root", () => {
    const root = {
      dataset: {} as DOMStringMap,
      style: { colorScheme: "" },
    };
    applyResolvedAppearance("light", root as unknown as HTMLElement);
    expect(root.dataset.theme).toBe("light");
    expect(root.style.colorScheme).toBe("light");
  });

  it("stays dark whatever the preference or the system asks for", () => {
    expect(PINNED_APPEARANCE).toBe("dark");
    expect(applyUiAppearance("light", "light")).toBe("dark");
    expect(applyUiAppearance("system", "light")).toBe("dark");
  });
});
