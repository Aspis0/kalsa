/**
 * The pause ending is wired at both completion sites of a turn (the round
 * and the tool fallback): ONE helper owns the KALSA_GOVERNOR_PAUSE evidence
 * line and both existing copy keys, so no site can finalise a paused result
 * as an ordinary empty reply. Source-level on purpose — LlamaService has no
 * runtime harness; what stays unpinned is the emitEngineError → onError path
 * itself (the declared F5 gap).
 */
import { readFileSync } from "fs";
import { join } from "path";

const noComments = readFileSync(join(__dirname, "LlamaService.ts"), "utf8")
  .replace(/\/\*[\S\s]*?\*\//g, "")
  .replace(/^[ \t]*\/\/.*$/gm, "");

test("the helper exists once and both completion sites call it", () => {
  // definition + the round + the tool fallback — no site may bypass it.
  expect(noComments.match(/endOnGovernorPause\(/g)).toHaveLength(3);
});

test("the helper alone owns the evidence line and both copy keys", () => {
  const start = noComments.indexOf("function endOnGovernorPause");
  expect(start).toBeGreaterThan(0);
  const helper = noComments.slice(
    start,
    noComments.indexOf("function sessionErrorReason", start),
  );
  expect(helper).toContain("KALSA_GOVERNOR_PAUSE");
  expect(helper).toContain("strings.errors.coolingTimedOut");
  expect(helper).toContain("strings.chat.serviceUnreachable");
  // The give-up copy is referenced exactly once in the whole file: inside
  // the helper — a site re-deriving it would mean the ending map drifted.
  expect(noComments.match(/strings\.errors\.coolingTimedOut/g)).toHaveLength(1);
});
