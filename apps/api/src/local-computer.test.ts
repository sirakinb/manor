import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "local-computer.ts"),
  "utf8",
);

function handleLocalComputerSocketSource() {
  const start = source.indexOf("async function handleLocalComputerSocket");
  expect(start).toBeGreaterThanOrEqual(0);
  return source.slice(start);
}

describe("handleLocalComputerSocket", () => {
  it('does not await before ws.on("message")', () => {
    const fn = handleLocalComputerSocketSource();
    const messageListener = fn.search(/ws\.on\(\s*"message"/);
    const firstAwait = fn.search(/\bawait\b/);
    expect(messageListener).toBeGreaterThan(0);
    expect(firstAwait).toBeGreaterThan(messageListener);
  });
});
