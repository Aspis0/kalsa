/**
 * Source-level wiring of governor pauses across LlamaService: both TURN
 * completion sites (the round and the tool fallback) must wait through the
 * cooling loop and END a pause through the one GUARDED helper — a call whose
 * return is ignored would let the fallback re-append toolRoundsExhausted —
 * and each UTILITY completion must detect a pause through the shared helper
 * and consume its return. Every evidence LINE is built by
 * governorPauseLog.ts: this file pins that the turn file holds no raw
 * emitter, that each EMISSION SITE logs exactly once per event (a built
 * line logged twice is the audit's green mutation), and that the builders
 * themselves only build. Source pins on purpose: LlamaService has no
 * runtime harness; payload and per-event cardinality are pinned in
 * governorPauseLog.test.ts, the emitEngineError → onError path stays the
 * declared F5 gap.
 */
import { readFileSync } from "fs";
import { join } from "path";

const stripComments = (text: string) =>
  text.replace(/\/\*[\S\s]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const noComments = stripComments(readFileSync(join(__dirname, "LlamaService.ts"), "utf8"));

/** Comment-stripped region between two stable markers (end exclusive). */
function region(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  expect(from).toBeGreaterThan(-1);
  const to = source.indexOf(end, from + start.length);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
}

test("both turn completion sites wait through the cooling loop", () => {
  // The round and the tool fallback — a utility path must not grow one.
  expect(noComments.match(/resumeWhileCooling\(/g)).toHaveLength(2);
});

test("both turn completion sites END a pause through the guarded helper", () => {
  // Only `if (endOnGovernorPause(...)) { return; }` counts: a bare call (its
  // return ignored) is not a guard, and at the fallback the turn would fall
  // through to the canned toolRoundsExhausted message.
  const guarded =
    noComments.match(
      /if\s*\(\s*endOnGovernorPause\([\s\S]*?\)\s*\)\s*(?:\{\s*return;\s*\}|return;)/g,
    ) ?? [];
  expect(guarded).toHaveLength(2);
});

test("the turn helper owns both copy keys and emits its line exactly once", () => {
  const helper = region(noComments, "function endOnGovernorPause", "function sessionErrorReason");
  expect(helper).toContain("strings.errors.coolingTimedOut");
  expect(helper).toContain("strings.chat.serviceUnreachable");
  // The give-up copy appears exactly once in the file: inside that helper.
  expect(noComments.match(/strings\.errors\.coolingTimedOut/g)).toHaveLength(1);
  // Exactly one emission per pause: one console and one builder call — a
  // built line logged twice (or a second builder call) fails here.
  expect(helper.match(/console\./g)).toHaveLength(1);
  expect(helper.match(/governorPauseLogLine\(/g)).toHaveLength(1);
});

test("the cooling listener emits exactly one built line per event", () => {
  // Slice the whole onCooling listener of coolingRound (up to the round loop
  // that follows the factory): logging the same built line twice — the
  // audit's green mutation — doubles the console count here.
  const listener = region(
    noComments,
    "onCooling: (phase, detail) => {",
    "for (let round = 0; round <",
  );
  expect(listener.match(/console\./g)).toHaveLength(1);
  expect(listener.match(/thermalCoolingLogLine\(/g)).toHaveLength(1);
});

test("the line builders only build — no console side effect inside them", () => {
  const module = stripComments(
    readFileSync(join(__dirname, "governorPauseLog.ts"), "utf8"),
  );
  const pauseBuilder = region(
    module,
    "export function governorPauseLogLine",
    "export function utilityGovernorPause",
  );
  const coolingBuilder = module.slice(module.indexOf("export function thermalCoolingLogLine"));
  expect(pauseBuilder).not.toContain("console.");
  expect(coolingBuilder).not.toContain("console.");
});

test("every evidence line comes from the one module — no raw emitter in the turn file", () => {
  // Cardinality at the source level: each builder called exactly once, and
  // neither evidence key exists here, so a duplicate line must be added
  // through (and pinned by) governorPauseLog.test.ts instead.
  expect(noComments.includes("KALSA_GOVERNOR_PAUSE")).toBe(false);
  expect(noComments.includes("KALSA_THERMAL_COOLING")).toBe(false);
  expect(noComments.match(/governorPauseLogLine\(/g)).toHaveLength(1);
  expect(noComments.match(/thermalCoolingLogLine\(/g)).toHaveLength(1);
});

test("every utility completion detects a pause through the shared helper, as a condition", () => {
  // The helper's definition lives in governorPauseLog.ts — three call sites.
  expect(noComments.match(/utilityGovernorPause\(/g)).toHaveLength(3);
  const guardedSites = [
    ...noComments.matchAll(/if\s*\(\s*utilityGovernorPause\(result, "(\w+)"\)\)/g),
  ].map((match) => match[1] ?? "");
  expect(guardedSites.sort()).toEqual(["completeOnce", "extractMemory", "translate"]);
});
