/**
 * Source-level wiring of governor pauses across LlamaService: both TURN
 * completion sites (the round and the tool fallback) must wait through the
 * cooling loop and END a pause through the one GUARDED helper — a call whose
 * return is ignored would let the fallback re-append toolRoundsExhausted —
 * and each UTILITY completion must detect a pause through the shared logger
 * and consume its return. Source pins on purpose: LlamaService has no
 * runtime harness; what stays unpinned is the emitEngineError → onError path
 * itself (the declared F5 gap).
 */
import { readFileSync } from "fs";
import { join } from "path";

const noComments = readFileSync(join(__dirname, "LlamaService.ts"), "utf8")
  .replace(/\/\*[\S\s]*?\*\//g, "")
  .replace(/^[ \t]*\/\/.*$/gm, "");

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

test("the turn helper alone owns both copy keys", () => {
  const start = noComments.indexOf("function endOnGovernorPause");
  expect(start).toBeGreaterThan(0);
  const helper = noComments.slice(
    start,
    noComments.indexOf("function utilityGovernorPause", start),
  );
  expect(helper).toContain("KALSA_GOVERNOR_PAUSE");
  expect(helper).toContain("strings.errors.coolingTimedOut");
  expect(helper).toContain("strings.chat.serviceUnreachable");
  // The give-up copy appears exactly once in the file: inside that helper.
  expect(noComments.match(/strings\.errors\.coolingTimedOut/g)).toHaveLength(1);
  // One KALSA_GOVERNOR_PAUSE emitter per helper — turn sites and utility
  // sites share these two, nothing logs the key ad hoc.
  expect(noComments.match(/KALSA_GOVERNOR_PAUSE/g)).toHaveLength(2);
});

test("every utility completion detects a pause through the shared logger, as a condition", () => {
  // definition + the three utility sites
  expect(noComments.match(/utilityGovernorPause\(/g)).toHaveLength(4);
  const guardedSites = [
    ...noComments.matchAll(/if\s*\(\s*utilityGovernorPause\(result, "(\w+)"\)\)/g),
  ].map((match) => match[1] ?? "");
  expect(guardedSites.sort()).toEqual(["completeOnce", "extractMemory", "translate"]);
});
