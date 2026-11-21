// @vitest-environment jsdom

import type { BotAvatarSet } from "@rakazo/contracts";
import type { ReactNode } from "react";
import { act, useState } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
}));

import { AvatarStudioPopover } from "./avatar-studio-popover";

let container: HTMLDivElement;
let root: Root;
const changed = vi.fn<(value: string, avatarSet?: BotAvatarSet) => void>();

function Harness({
  value: initial,
  avatarSet: initialSet,
}: {
  value: string;
  avatarSet?: BotAvatarSet;
}) {
  const [value, setValue] = useState(initial);
  const [avatarSet, setAvatarSet] = useState(initialSet);
  return (
    <AvatarStudioPopover
      value={value}
      identity="sample-bot"
      avatarSet={avatarSet}
      onChange={(next, nextSet) => {
        changed(next, nextSet);
        setValue(next);
        if (nextSet !== undefined) setAvatarSet(nextSet);
      }}
    />
  );
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as typeof window.matchMedia;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  changed.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
function button(name: string) {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.getAttribute("aria-label") === name || node.textContent === name,
  );
  if (!found) throw new Error(`Missing button ${name}`);
  return found;
}
async function click(name: string) {
  await act(async () => button(name).click());
}
async function render(value: string, avatarSet?: BotAvatarSet, key = "initial") {
  await act(async () => root.render(<Harness key={key} value={value} avatarSet={avatarSet} />));
}

function hasButton(name: string) {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].some(
    (node) => node.getAttribute("aria-label") === name || node.textContent === name,
  );
}

// Manor does not offer upstream's logo ("Rakazo") set; a bot already on it still draws.
describe("selectable bot icon sets", () => {
  it("does not offer the logo set to a bot on the Original set", async () => {
    await render("#10B981");
    await click("Customize bot avatar");
    expect(hasButton("Rakazo")).toBe(false);
    expect(hasButton("Original")).toBe(false);
    expect(document.querySelector(".rakazo-organic-avatar")).not.toBeNull();
    expect(changed).not.toHaveBeenCalled();
  });

  it("still draws a bot whose data carries the logo set, without offering a set choice", async () => {
    await render("#10B981", "rakazo");
    expect(document.querySelector(".rakazo-logo-avatar")).not.toBeNull();
    await click("Customize bot avatar");
    expect(hasButton("Rakazo")).toBe(false);
    expect(hasButton("Original")).toBe(false);
    expect(changed).not.toHaveBeenCalled();
  });

  it("leaves a photo intact while the studio is open", async () => {
    const photo = "data:image/png;base64,abc";
    await render(photo);
    expect(document.querySelector(`img[src="${photo}"]`)).not.toBeNull();
    await click("Customize bot avatar");
    expect(changed).not.toHaveBeenCalled();
    expect(document.querySelector(`img[src="${photo}"]`)).not.toBeNull();
  });

  it("keeps explicit original shapes while changing colour", async () => {
    await render("#8B5CF6::shape_2", "organic");
    await click("Customize bot avatar");
    expect(changed).not.toHaveBeenCalled();
    await click("Color #10B981");
    expect(changed).toHaveBeenLastCalledWith("#10B981::shape_2", undefined);
    expect(hasButton("Rakazo")).toBe(false);
  });
});
