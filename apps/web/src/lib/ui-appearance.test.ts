import {
  persistAppearancePreference,
  resolveAppearancePreference,
  UI_APPEARANCE_STORAGE_KEY,
} from "@rakazo/ui-tokens";
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

  it("persists preference through storage helpers", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    };
    persistAppearancePreference("dark", storage);
    expect(store.get(UI_APPEARANCE_STORAGE_KEY)).toBe("dark");
    expect(resolveAppearancePreference({ storage })).toBe("dark");
  });
});
