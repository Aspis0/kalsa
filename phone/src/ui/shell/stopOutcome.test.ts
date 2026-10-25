/**
 * §2.8's four stop outcomes, as the decision layer returns them — moved
 * verbatim out of `composerState.test.ts` when that file crossed the shell's
 * 350-line line; nothing was weakened in the move. The two helpers it needs
 * were copied alongside rather than imported, so both files stay
 * self-contained and neither imports the other (a test file importing a test
 * file would run its suite twice).
 */
import { en, it as italian } from "../../i18n";
import { stopOutcome, type StopReport } from "./composerState";

/** One string leaf of a catalogue by its dotted key, or undefined. */
function leaf(catalog: unknown, key: string): string | undefined {
  let node: unknown = catalog;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

/** Throws unless BOTH catalogues hold a real, non-empty line for the key. */
function assertKeyInBoth(key: string): void {
  for (const [name, catalog] of [["en", en], ["it", italian]] as const) {
    const text = leaf(catalog, key);
    if (typeof text !== "string" || text === "" || text === key) {
      throw new Error(`key "${key}" is missing or hollow in the ${name} catalogue`);
    }
  }
}

/** The design's four rows, paired with what the engine reports for each. */
const STOP_CASES: ReadonlyArray<readonly [string, StopReport]> = [
  ["stoppedByUser", { cause: "user", tokens: 42 }],
  ["stoppedEmpty", { cause: "user", tokens: 0 }],
  ["thermal", { cause: "thermal" }],
  ["failed", { cause: "error", reason: "CUDA out of memory" }],
];

describe("§2.8 — stop's four outcomes", () => {
  it("returns exactly the four outcomes the design's table lists", () => {
    expect(STOP_CASES.map(([outcome]) => outcome)).toEqual(["stoppedByUser", "stoppedEmpty", "thermal", "failed"]);
    for (const [, report] of STOP_CASES) expect(stopOutcome(report).outcome).toBeTruthy();
  });

  it("keeps the user's partial answer marked and copyable", () => {
    const view = stopOutcome({ cause: "user", tokens: 7 });
    expect(view.line).toEqual({ key: "shell.phase.stoppedByUser" });
    expect(view.tone).toBe("quiet");
    expect(view.actions).toEqual([]);
    expect(view.keepsPartial).toBe(true);
  });

  it("keeps nothing when the stop came before any token, whatever the count says", () => {
    for (const tokens of [0, -3, Number.NaN]) {
      const view = stopOutcome({ cause: "user", tokens });
      expect(view.outcome).toBe("stoppedEmpty");
      expect(view.line.key).toBe("shell.phase.stoppedEmpty");
      expect(view.keepsPartial).toBe(false);
    }
  });

  it("offers the thermal row only the actions the engine can honour", () => {
    const view = stopOutcome({ cause: "thermal" });
    expect(view.line.key).toBe("shell.phase.tooHot");
    expect(view.tone).toBe("attention");
    expect(view.actions).toEqual(["shell.action.wait", "shell.action.stop"]);
    expect(view.keepsPartial).toBe(true);
    // "wait, stop" and never "retry": starting a run the governor holds
    // would be an action the engine refuses, dressed as a button.
    expect(view.actions).not.toContain("shell.action.retry");
    expect(view.actions).not.toContain("shell.action.loadModel");
  });

  it("shows the engine's own reason in danger, never a generic apology", () => {
    for (const reason of ["CUDA out of memory", "llama.cpp: assert failed", "💥 decode session halted"]) {
      const view = stopOutcome({ cause: "error", reason });
      expect(view.outcome).toBe("failed");
      expect(view.tone).toBe("danger");
      expect(view.line).toEqual({ key: "shell.composer.stopFailed", params: { reason } });
    }
  });

  it("falls back to the honest line when the engine gives no reason at all", () => {
    // `stopFailed` with a blank tail — "Stopped by an error: " — is the
    // generic shape §2.8 forbids, so a reasonless failure must not reach it.
    for (const reason of ["", "   "]) {
      const view = stopOutcome({ cause: "error", reason });
      expect(view.line).toEqual({ key: "shell.phase.failed" });
      expect(view.tone).toBe("danger");
    }
  });

  it("resolves every line and action it can return in both catalogues", () => {
    for (const [, report] of STOP_CASES) {
      const view = stopOutcome(report);
      assertKeyInBoth(view.line.key);
      for (const action of view.actions) assertKeyInBoth(action);
    }
    assertKeyInBoth(stopOutcome({ cause: "error", reason: "" }).line.key);
  });
});
