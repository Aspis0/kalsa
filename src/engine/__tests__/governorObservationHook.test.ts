/**
 * Source-text guards for the Stage 0 hook (LlamaService is never loaded under
 * jest): the observation read sits on the live path only — after the stop
 * check and the governor-pause check, beside recordBenchCompletion — with
 * the reader module's 2 s + stop-signal race, a fire-and-forget append, gap
 * marks on the stop/pause returns, and the delta baseline reset on every
 * path that clears the engine's counters.
 */
import fs from "fs";
import path from "path";

const read = (rel: string): string =>
  fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

const service = read("LlamaService.ts");
const reader = read("governorObservationRead.ts");

test("the observation hook sits after the stop and pause checks, with gap marks", () => {
  const hook = service.indexOf("const observationRow = governorThermo");
  const stopCheck = service.lastIndexOf("if (bailIfStopped()) {", hook);
  const pauseCheck = service.lastIndexOf("endOnGovernorPause(result, turnId, round", hook);
  const benchRecord = service.lastIndexOf("recordBenchCompletion(result);", hook);
  expect(hook).toBeGreaterThan(-1);
  expect(stopCheck).toBeGreaterThan(-1);
  expect(pauseCheck).toBeGreaterThan(stopCheck);
  expect(benchRecord).toBeGreaterThan(pauseCheck);
  expect(hook).toBeGreaterThan(benchRecord);
  // Between the pause check and the hook: the two skipped-read returns mark
  // the gap (the next row must carry gap:1), and nothing else returns.
  const region = service.slice(stopCheck, hook);
  expect(region.match(/markObservationGap\(\);/g)?.length).toBe(2);
  expect(region).toContain("recordBenchCompletion(result);");
});

test("the stats read is stop-raced and 2 s bounded; the append is fire-and-forget", () => {
  expect(reader).toContain("export const OBSERVATION_STATS_TIMEOUT_MS = 2_000;");
  // The read races the turn's abort signal so a stop ends the wait at once.
  expect(reader).toMatch(/Promise\.race\(\[args\.engine\.getGovernorStats\(\), stopRace\]\)/);
  expect(reader).toContain('args.signal?.addEventListener(\n      "abort",');
  // A stop, timeout, failure, or a baseline reset under the read (the
  // generation check) marks the gap and drops the row: once in
  // markObservationGap (the service's skipped-read paths), once in the
  // reader's catch, once in its generation guard.
  expect(reader.match(/gapPending = true;/g)?.length).toBe(3);
  expect(service).toMatch(/void appendObservation\(observationRow\);/);
  expect(service).toContain(
    "`KALSA_GOVERNOR_COMPLETION ${JSON.stringify(completionLogRow(observationRow))}`",
  );
});

test("every counter-clearing path resets the observation baseline", () => {
  // The engine zeroes its decode counters on clear_cache and on the
  // teardown; the baseline must restart at each. Exactly four resets: the
  // three context/engine.clearCache() sites and the engine teardown.
  expect(service.match(/resetObservationBaseline\(\);/g)?.length).toBe(4);
  for (const clearSite of service.matchAll(/\.clearCache\(\)/g)) {
    const after = service.slice(clearSite.index ?? 0, (clearSite.index ?? 0) + 600);
    expect(after).toContain("resetObservationBaseline();");
  }
});
