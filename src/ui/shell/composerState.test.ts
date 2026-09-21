/**
 * The composer's decision layer, proved against DESIGN.md §2.7 (two answers,
 * one reason line, the chip) and §2.8 (three faces, four outcomes). The
 * proofs are the refusals, not the happy paths: a refusing field that still
 * shows the invite (the old `Fai una domanda…` over `editable={false}`,
 * AiChatPage.tsx:4339), a held state with no reason or with a reason the
 * catalogues do not hold, `stopping` falling back to `send`, and a key added
 * to the module but not to `en.ts`/`it.ts`. Every guard is run against a
 * sample that must make it fail — a guard that cannot fail is worse than none.
 */
import { readFileSync } from "fs";
import { join } from "path";

// `it` is the Italian catalogue; the alias keeps jest's global `it` intact.
import { en, it as italian } from "../../i18n";
import {
  COMPOSER_PHASES,
  composerState,
  stopOutcome,
  type ComposerPhase,
  type ComposerState,
  type StopReport,
} from "./composerState";

const MODULE_SOURCE = readFileSync(join(__dirname, "composerState.ts"), "utf8");

/** One string leaf of a catalogue by its dotted key, or undefined. */
function leaf(catalog: unknown, key: string): string | undefined {
  let node: unknown = catalog;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

function render(text: string, params: Readonly<Record<string, string>>): string {
  return text.replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? `{${name}}`);
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

/**
 * Throws on either shape the design forbids: a refusal with no single reason
 * line, or a reason the catalogues do not hold. Every real state goes through
 * this, and the samples below prove it can fail.
 */
function assertHonest(state: ComposerState): void {
  const refusing = (state.field as { editable: boolean }).editable === false;
  if (refusing !== (state.field.placeholder === null)) {
    throw new Error("a refusing field with an invite");
  }
  if ((refusing || !state.canSend) && state.hold === null) {
    throw new Error("a refusal with no reason line");
  }
  if (state.hold !== null) assertKeyInBoth(state.hold);
}

/** The design's own table: which phase holds, and with which single line. */
const EXPECTED_HOLD: Readonly<Record<string, string | null>> = {
  idle: null,
  loading: "shell.held.loading",
  prefill: "shell.held.prefill",
  thinking: "shell.held.thinking",
  writing: "shell.held.writing",
  stopping: "shell.held.stopping",
  tooHot: "shell.held.tooHot",
  unloaded: "shell.held.unloaded",
  converting: "shell.held.converting",
};

const HELD_CASES = Object.entries(EXPECTED_HOLD).filter((entry): entry is [string, string] => entry[1] !== null);
const GENERATING: readonly ComposerPhase[] = ["prefill", "thinking", "writing"];
/** The phases where the design grants no typing, so the refusal must show. */
const FIELD_REFUSING: readonly ComposerPhase[] = ["loading", "tooHot", "unloaded", "converting"];

/** The design's four rows, paired with what the engine reports for each. */
const STOP_CASES: ReadonlyArray<readonly [string, StopReport]> = [
  ["stoppedByUser", { cause: "user", tokens: 42 }],
  ["stoppedEmpty", { cause: "user", tokens: 0 }],
  ["thermal", { cause: "thermal" }],
  ["failed", { cause: "error", reason: "CUDA out of memory" }],
];

function state(phase: ComposerPhase, attachment?: string | null): ComposerState {
  return composerState({ phase, attachment });
}

describe("§2.7 — the field and the send are two different answers", () => {
  it("grants both when idle", () => {
    const s = state("idle");
    expect(s.field).toEqual({ editable: true, placeholder: "shell.composer.placeholder" });
    expect(s.canSend).toBe(true);
    expect(s.hold).toBeNull();
    expect(s.face).toBe("send");
    expect(s.faceEnabled).toBe(true);
  });

  it.each(GENERATING)("keeps typing and holds sending while the model is %s", (phase) => {
    const s = state(phase);
    // The two answers, disagreeing on purpose: this is §2.7's whole point.
    expect(s.field.editable).toBe(true);
    expect(s.field.placeholder).not.toBeNull();
    expect(s.canSend).toBe(false);
    expect(s.face).toBe("stop");
    expect(s.faceEnabled).toBe(true);
  });

  it.each(FIELD_REFUSING)("refuses the field with its line, never an invite, in %s", (phase) => {
    const s = state(phase);
    expect(s.field).toEqual({ editable: false, placeholder: null });
    expect(s.canSend).toBe(false);
    expect(s.hold).not.toBeNull();
    expect(s.face).toBe("send");
    expect(s.faceEnabled).toBe(false);
  });

  it("returns no phase whose refusing field still carries the placeholder", () => {
    // The old composer's exact bug, checked over every reachable state.
    for (const phase of COMPOSER_PHASES) {
      const s = state(phase);
      expect(s.field.editable).toBe(s.field.placeholder !== null);
      assertHonest(s);
    }
  });

  it("returns no refusal without a reason, and no reason without a refusal", () => {
    for (const phase of COMPOSER_PHASES) {
      const s = state(phase);
      expect(s.canSend).toBe(s.hold === null);
      expect(s.hold === null).toBe(phase === "idle");
    }
  });
});

describe("one test per held state: the reason line", () => {
  it.each(HELD_CASES)("holds %s with exactly the design's line, present in both catalogues", (phase, key) => {
    expect(state(phase as ComposerPhase).hold).toBe(key);
    assertKeyInBoth(key);
  });

  it("never lets a phase drift from the union the module exports", () => {
    // Exact, not "contains": a phase added to the union must join this table
    // and the catalogues before anything can decide it — the same ratchet
    // `toolLabels.test.ts` applies against the registry's own list.
    expect([...COMPOSER_PHASES].sort()).toEqual(Object.keys(EXPECTED_HOLD).sort());
  });

  it("would fail on each disallowed shape, so the guards are not vacuous", () => {
    const good = state("thinking");
    // A reason added to the module and not to the catalogues:
    expect(() => assertKeyInBoth("shell.held.repairing")).toThrow();
    expect(() => assertHonest({ ...good, hold: "shell.held.repairing" as never })).toThrow();
    // A holding state added with no reason at all:
    expect(() => assertHonest({ ...good, hold: null, canSend: false })).toThrow();
    // The old bug, doctored in past the union — the runtime guard's job:
    expect(() =>
      assertHonest({ ...good, field: { editable: false, placeholder: "shell.composer.placeholder" } as never }),
    ).toThrow();
    // And the honest shapes must pass, or the guards fail everything:
    expect(() => assertHonest(good)).not.toThrow();
    expect(() => assertHonest(state("idle"))).not.toThrow();
  });

  it("holds an unknown phase with a line instead of reading as idle", () => {
    // The phase is a wire value; a JS caller can hand over anything. Claiming
    // ready here would be the interface saying the machine stopped first.
    const s = composerState({ phase: "repairing" as ComposerPhase });
    expect(s.hold).toBe("shell.held.unknown");
    expect(s.canSend).toBe(false);
    expect(s.faceEnabled).toBe(false);
    expect(s.field).toEqual({ editable: false, placeholder: null });
    assertHonest(s);
  });
});

describe("§2.8 — one control, three faces", () => {
  it.each([...GENERATING, "stopping"] as ComposerPhase[])("shows %s as its own face, never as send", (phase) => {
    const s = state(phase);
    expect(s.face).not.toBe("send");
    expect(s.face).toBe(phase === "stopping" ? "stopping" : "stop");
  });

  it("keeps stopping visible and inert until the engine releases", () => {
    const s = state("stopping");
    // The invariant in the design's words: the interface never claims the
    // machine has stopped before the machine has — the only input that can
    // produce face "send" is the next phase being something else.
    expect(s.face).toBe("stopping");
    expect(s.faceEnabled).toBe(false);
    expect(s.faceLabel).toBe("shell.composer.stopping");
    expect(s.hold).toBe("shell.held.stopping");
  });

  it("enables the control exactly where a tap does something (§2.11)", () => {
    for (const phase of COMPOSER_PHASES) {
      const acts = phase === "idle" || GENERATING.includes(phase);
      expect(state(phase).faceEnabled).toBe(acts);
    }
  });

  it("names each face for the screen reader from the catalogues", () => {
    const labels = new Set(COMPOSER_PHASES.map((phase) => state(phase).faceLabel));
    expect(labels).toEqual(new Set(["shell.a11y.send", "shell.a11y.stop", "shell.composer.stopping"]));
    for (const label of labels) assertKeyInBoth(label);
    assertKeyInBoth(state("idle").fieldLabel);
  });
});

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

describe("§2.7 — the attachment is a chip, never a bare filename", () => {
  it("returns a label with the name inside it, in both catalogues' words", () => {
    const view = state("idle", "fisica.pdf").attachment;
    expect(view).toEqual({ key: "shell.composer.attachment", params: { name: "fisica.pdf" } });
    expect(view).not.toBeNull();
    // Exactly the design's example, once interpolated into Italian:
    expect(render(leaf(italian, view!.key)!, view!.params)).toBe("Legge da fisica.pdf");
    expect(render(leaf(en, view!.key)!, view!.params)).toBe("Reading from fisica.pdf");
    // No field to render on its own: the filename only ever travels inside
    // the labelled key.
    expect(Object.keys(view!).sort()).toEqual(["key", "params"]);
  });

  it("draws no chip when nothing is attached, or the name is blank", () => {
    expect(state("idle").attachment).toBeNull();
    expect(state("idle", null).attachment).toBeNull();
    expect(state("idle", "   ").attachment).toBeNull();
  });
});

describe("the module itself: every key, and no clock, no engine, no React", () => {
  it("returns only keys both catalogues hold — collected from real outputs", () => {
    const keys = new Set<string>();
    for (const phase of [...COMPOSER_PHASES, "repairing" as ComposerPhase]) {
      for (const attachment of [undefined, "fisica.pdf"]) {
        const s = composerState({ phase, attachment });
        if (s.hold !== null) keys.add(s.hold);
        if (s.field.placeholder !== null) keys.add(s.field.placeholder);
        keys.add(s.faceLabel);
        keys.add(s.fieldLabel);
        if (s.attachment) keys.add(s.attachment.key);
      }
    }
    for (const report of [...STOP_CASES.map(([, r]) => r), { cause: "error", reason: "  " } as StopReport]) {
      const view = stopOutcome(report);
      keys.add(view.line.key);
      for (const action of view.actions) keys.add(action);
    }
    // The collector itself: a guard that silently collected nothing would
    // pass every key check while proving nothing.
    expect(keys.size).toBeGreaterThanOrEqual(22);
    for (const key of keys) assertKeyInBoth(key);
  });

  it("holds no clock: stopping ends when the phase says the engine released", () => {
    // §2.8: the release is an input, not a duration. The 3 s watchdog the old
    // UI skipped is the bug this check exists to keep out — so the module
    // source itself must contain no way to wait.
    const code = MODULE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    expect(code).not.toMatch(/setTimeout|setInterval|Date\.now|performance\.now|new Date\b/);
    expect(state("stopping")).toEqual(state("stopping"));
  });

  it("imports nothing but the catalogue types — and the guard can fail", () => {
    const specifiers = [...MODULE_SOURCE.matchAll(/^\s*import[\s\S]*?from\s+"([^"]+)";?/gm)].map(
      (match) => match[1],
    );
    // The one import exists, so this cannot pass by finding none; everything
    // it imports must be the catalogue.
    expect(specifiers.length).toBeGreaterThan(0);
    const forbidden = (specifier: string): boolean => specifier !== "../../i18n";
    expect(specifiers.filter(forbidden)).toEqual([]);
    // Samples: each is a shape the predicate must accept as forbidden.
    for (const sample of ["react", "../../engine", "../../app", "@react-native-async-storage/async-storage"]) {
      expect(forbidden(sample)).toBe(true);
    }
    expect(forbidden("../../i18n")).toBe(false);
  });
});
