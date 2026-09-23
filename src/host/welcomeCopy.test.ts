/** Replaced greeting and card-copy checks with the first-open gate contract. */
import { readFileSync } from "fs";
import { join } from "path";
import { welcomeVisible } from "./welcomeGate";

const SOURCE = readFileSync(join(__dirname, "welcomeGate.ts"), "utf8");
const SURFACE = readFileSync(join(__dirname, "HostChatSurface.tsx"), "utf8");

describe("the empty-state gate", () => {
  it("does not show before history settles, even when the chat appears empty", () => {
    expect(welcomeVisible(false, 0)).toBe(false);
    expect(welcomeVisible(false, 1)).toBe(false);
    expect(welcomeVisible(false, 42)).toBe(false);
  });

  it("shows only after history settles with zero messages", () => {
    expect(welcomeVisible(true, 0)).toBe(true);
    for (const count of [1, 2, 42]) expect(welcomeVisible(true, count)).toBe(false);
  });

  it("does not treat invalid or negative message counts as empty", () => {
    expect(welcomeVisible(true, -1)).toBe(false);
    expect(welcomeVisible(true, Number.NaN)).toBe(false);
  });

  it("keeps the decision a single exact condition and the host calls it", () => {
    expect(SOURCE).toContain("return historyLoaded && messageCount === 0");
    expect(SURFACE).toContain("welcomeVisible(view.historyLoaded, view.transcript.length)");
  });
});
