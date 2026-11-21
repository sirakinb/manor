// @vitest-environment jsdom

import type { MessageBlock } from "@rakazo/contracts";
import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, "");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});

import type { ActivityItem } from "./ActivityTimeline";
import { ActivityTimeline, groupNarrationBlocks, proseTexts } from "./ActivityTimeline";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const NOTE = "Anna is free all Tuesday afternoon.";
const steps: ActivityItem = {
  kind: "steps",
  steps: [
    { label: "Open calendar", count: 1 },
    { label: "Check conflicts", count: 1, note: NOTE },
  ],
};

function notes() {
  return [...container.querySelectorAll('[data-testid="tool-step-note"]')].map(
    (node) => node.textContent,
  );
}

it("shows a step's note under its row, live and finished", () => {
  for (const live of [true, false]) {
    act(() => root.render(<ActivityTimeline items={[steps]} live={live} />));
    expect(notes()).toEqual([NOTE]);
    const note = container.querySelector('[data-testid="tool-step-note"]')!;
    expect(note.previousElementSibling?.textContent).toContain("Check conflicts");
    expect(note.querySelector("button")).toBeNull();
  }
});

it("does not repeat a note the narration already shows", () => {
  const blocks: MessageBlock[] = [steps, { kind: "progress", text: `${NOTE}\n` }];
  const entries = groupNarrationBlocks(blocks);
  const shownProse = proseTexts(entries);
  act(() => root.render(<ActivityTimeline items={[steps]} live={true} shownProse={shownProse} />));
  expect(notes()).toEqual([]);
  act(() => root.render(<ActivityTimeline items={[steps]} live={false} shownProse={new Set()} />));
  expect(notes()).toEqual([NOTE]);
});
