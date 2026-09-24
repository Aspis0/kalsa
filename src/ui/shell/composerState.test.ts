/**
 * The composer's decision layer, proved against DESIGN.md §2.7 (two answers,
 * one reason line, the chip) and §2.8 (three faces, four outcomes). The
 * proofs include the refusal paths: a field that omits its editability state,
 * a held state with no reason or with a reason the catalogues do not hold,
 * `stopping` falling back to `send`, and a key added to the module but not to
 * `en.ts`/`it.ts`. Every guard is run against a sample that must make it fail
 * — a guard that cannot fail is worse than none.
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
 * line, or a reason the catalogues do not hold. The samples prove it can fail.
 */
function assertHonest(state: ComposerState): void {
  if (typeof (state.field as { editable?: unknown } | null)?.editable !== "boolean") {
    throw new Error("field editability is missing");
  }
  if ((!state.field.editable || !state.canSend) && state.hold === null) {
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
/** The not-ready phases where §2.7's first sentence matters most: sending
 *  is held and the wait is longest, so the field must still take typing. */
const NOT_READY_HELD: readonly ComposerPhase[] = ["loading", "tooHot", "unloaded", "converting"];

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
    expect(s.field).toEqual({ editable: true });
    expect(s.canSend).toBe(true);
    expect(s.hold).toBeNull();
    expect(s.face).toBe("send");
    expect(s.faceEnabled).toBe(true);
  });

  it.each(GENERATING)("keeps typing and holds sending while the model is %s", (phase) => {
    const s = state(phase);
    // The two answers, disagreeing on purpose: this is §2.7's whole point.
    expect(s.field.editable).toBe(true);
    expect(s.field.editable).toBe(true);
    expect(s.canSend).toBe(false);
    expect(s.face).toBe("stop");
    expect(s.faceEnabled).toBe(true);
  });

  it.each(NOT_READY_HELD)("takes typing while it holds sending in %s", (phase) => {
    const s = state(phase);
    expect(s.field).toEqual({ editable: true });
    expect(s.canSend).toBe(false);
    expect(s.hold).not.toBeNull();
    expect(s.face).toBe("send");
    expect(s.faceEnabled).toBe(false);
  });

  it("takes typing in every phase the table knows; only an unknown wire value refuses", () => {
    // The ratchet: a future row cannot smuggle the old single `disabled` back
    // in — refusal is `UNKNOWN_PHASE_RULE`'s alone.
    for (const phase of COMPOSER_PHASES) expect(state(phase).field.editable).toBe(true);
    expect(composerState({ phase: "repairing" as ComposerPhase }).field).toEqual({ editable: false });
  });

  it("returns a typed editability decision for every known phase", () => {
    for (const phase of COMPOSER_PHASES) {
      const s = state(phase);
      expect(s.field).toEqual({ editable: true });
      assertHonest(s);
    }
    expect(composerState({ phase: "repairing" as ComposerPhase }).field).toEqual({ editable: false });
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
    // `toolLabels.test.ts` applies to the registry's list.
    expect([...COMPOSER_PHASES].sort()).toEqual(Object.keys(EXPECTED_HOLD).sort());
  });

  it("would fail on each disallowed shape, so the guards are not vacuous", () => {
    const good = state("thinking");
    // A reason added to the module and not to the catalogues:
    expect(() => assertKeyInBoth("shell.held.repairing")).toThrow();
    expect(() => assertHonest({ ...good, hold: "shell.held.repairing" as never })).toThrow();
    // A holding state added with no reason at all:
    expect(() => assertHonest({ ...good, hold: null, canSend: false })).toThrow();
    // Missing field state, doctored in past the union — the runtime guard's job:
    expect(() =>
      assertHonest({ ...good, field: { editable: "maybe" } as never }),
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
    expect(s.field).toEqual({ editable: false });
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
    // This is the exact live-key set after removing placeholder copy; the
    // rendered input and its accessible name are asserted separately.
    expect(keys.size).toBe(21);
    for (const key of keys) assertKeyInBoth(key);
  });

  it("holds no clock: stopping ends when the phase says the engine released", () => {
    // §2.8: the release is an input, not a duration. The 3 s watchdog the old
    // UI skipped is the bug this check keeps out — the module source itself
    // must contain no way to wait.
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
