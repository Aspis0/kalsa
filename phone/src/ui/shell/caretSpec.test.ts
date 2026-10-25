/**
 * The caret's contract (DESIGN.md §2.11, controller rule at
 * `AiChatPage.tsx:5484`): which messages get one, the motion values, and the
 * component's own hygiene. The component half is checked by READING the file —
 * this repo has no render harness, and a source check that cannot fail is
 * worse than none, so every rule below is asserted against a sample that
 * would break it.
 */
import { readFileSync } from "fs";
import { join } from "path";

import { CARET_BLINK, CARET_GLYPH, caretVisible } from "./caretSpec";

const COMPONENT = readFileSync(join(__dirname, "StreamCaret.tsx"), "utf8");
const MAPPER = readFileSync(join(__dirname, "..", "..", "host", "messageMapper.ts"), "utf8");

describe("caretVisible — the controller's showCursor predicate", () => {
  it("shows the caret only while a non-empty answer is arriving", () => {
    expect(caretVisible(true, "The third method")).toBe(true);
    expect(caretVisible(true, " ")).toBe(true); // the old `!!m.text`: whitespace is text
    expect(caretVisible(true, "")).toBe(false); // no caret over nothing (pre-token think)
    expect(caretVisible(false, "done")).toBe(false); // a settled turn draws nothing
    expect(caretVisible(undefined, "done")).toBe(false); // the flag's absence is settled
  });

  it("cannot fail toward the lying direction: every false input stays false", () => {
    for (const streaming of [false, undefined, null as unknown as boolean]) {
      expect(caretVisible(streaming, "answer")).toBe(false);
    }
  });
});

describe("§2.11 — the motion is data, pinned to the design's row", () => {
  it("is one 1 → 0.35 → 1 cycle per second", () => {
    expect(CARET_BLINK.durationMs).toBe(1000);
    expect(CARET_BLINK.from).toBe(1);
    expect(CARET_BLINK.to).toBe(0.35);
    expect(CARET_BLINK.from).toBeGreaterThan(CARET_BLINK.to);
  });

  it("never blinks to invisibility — a vanished caret claims the turn ended", () => {
    // The direction §2.8 cares about: the floor is dim, not gone.
    expect(CARET_BLINK.to).toBeGreaterThan(0);
  });

  it("is frozen data the component cannot rewrite", () => {
    expect(Object.isFrozen(CARET_BLINK)).toBe(true);
    expect(() => {
      (CARET_BLINK as { to: number }).to = 0;
    }).toThrow();
  });

  it("keeps the controller's thin bar, not the block glyph that read as a missing font", () => {
    expect(CARET_GLYPH).toContain("\u2502"); // │ light vertical bar
    expect(CARET_GLYPH).not.toContain("\u258B"); // ▋ the abandoned block glyph
  });
});

describe("StreamCaret.tsx — the drawing obeys the data and the project rules", () => {
  it("exists and is non-empty, so every read below checks a real file", () => {
    expect(COMPONENT.length).toBeGreaterThan(500);
  });

  it("drives the blink from CARET_BLINK with linear timing and restarts on arrival", () => {
    expect(COMPONENT).toContain("CARET_BLINK");
    expect(COMPONENT).toContain("Easing.linear");
    expect(COMPONENT).toContain("setValue(CARET_BLINK.from)"); // frozen solid as text arrives
    expect(COMPONENT).toContain("Animated.loop");
  });

  it("honours reduce-motion (§2.11): the system's flag stops the blink", () => {
    expect(COMPONENT).toContain("isReduceMotionEnabled");
    expect(COMPONENT).toContain("reduceMotionChanged");
    expect(COMPONENT).toContain("if (reducedMotion) return");
  });

  it("hides the glyph from assistive tech, as the controller's caret did", () => {
    expect(COMPONENT).toContain("accessibilityElementsHidden");
    expect(COMPONENT).toContain('importantForAccessibility="no-hide-descendants"');
  });

  it("draws no weight of its own and never pads its hit box", () => {
    // No numeric fontWeight beside a custom family, and no hitSlop anywhere.
    expect(COMPONENT).not.toMatch(/fontWeight/);
    expect(COMPONENT).not.toMatch(/hitSlop/);
  });

  it("takes the glyph from the module, not a literal in the component", () => {
    expect(COMPONENT).toContain("CARET_GLYPH");
    expect(COMPONENT).not.toContain("\u2502"); // the bar itself lives in caretSpec.ts
  });
});

describe("the host routes the caret through the shared predicate", () => {
  it("messageMapper.ts calls caretVisible rather than re-deriving the rule", () => {
    expect(MAPPER).toContain('from "../ui/shell/caretSpec"');
    expect(MAPPER).toContain("caretVisible(");
  });

  it("the predicate read is non-vacuous: the mapper file is the real one", () => {
    expect(MAPPER.length).toBeGreaterThan(500);
    expect(MAPPER).toContain("toTranscriptMessage");
  });
});
