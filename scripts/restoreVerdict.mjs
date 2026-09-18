/**
 * State the verdict of a device restore run instead of leaving it in 2000
 * lines of logcat. Reads the evidence file grepped out of logcat by
 * device-restore-protocol.sh; prints one line per question.
 *
 * Its own file so it can be run against fixtures — it used to be a `node -e`
 * string inside the shell script, which meant the only way to find out whether
 * a counter was right was to run a phone.
 *
 * Usage: node scripts/restoreVerdict.mjs <evidence.txt>
 */
import { readFileSync } from "node:fs";
const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };
const evidencePath = process.argv[2];
const ev = read(evidencePath);
// A run whose logcat capture failed prints the same zeros as a run where the
// prefix was never reused, and the second reads like a finding. It is not one:
// exit non-zero so the protocol's pipeline fails instead of reporting it.
if (ev.trim() === "") {
  console.log("EVIDENCE: empty or unreadable — " + (evidencePath ?? "<no path given>"));
  console.log("KV_PREFIX_CRITERION: FAIL (no evidence captured; this is not a measurement)");
  process.exit(2);
}
const n = (re) => (ev.match(re) || []).length;
const evLines = ev.split("\n");
const jsonObjectAt = (line, start) => {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < line.length; i++) {
    const ch = line[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return line.slice(start, i + 1);
  }
  return null;
};
const parsePrewarmLine = (line) => {
  const tag = line.match(/KALSA_PREWARM\s+(?=\{)/) ??
    line.match(/'KALSA_PREWARM',\s*'(?=\{)/);
  if (!tag) return null;
  const payload = jsonObjectAt(line, line.indexOf("{", tag.index));
  if (!payload) return null;
  // React Native's console polyfill (node_modules/@react-native/js-polyfills/
  // console.js:175-186) leaves apostrophes escaped as \' after JSON.stringify;
  // JSON has no legal \' escape, so undo that wrapper escape before parsing.
  try {
    return JSON.parse(payload.replace(/\\'/g, "'"));
  } catch {
    return null;
  }
};
const prewarmEventsIn = (text) => text.split("\n")
  .map(parsePrewarmLine)
  .filter(Boolean);
const prewarmEvents = prewarmEventsIn(ev);
const prewarmCount = (predicate) => prewarmEvents.filter(predicate).length;
const unparsedPrewarmLines = evLines.filter((line) =>
  line.includes("KALSA_PREWARM") && !parsePrewarmLine(line),
).length;
// Criteria PRINT — the text is the product — and since the exit contract they
// also decide the status: 0 only when every printed criterion passed, 1 when
// a printed criterion FAILED (the run measured and says broken), 2 stays the
// empty evidence above (not a measurement at all). 1 and 2 must never blur.
let anyCriterionFailed = false;
console.log("PREFIX_PREWARM: restore_ok=" +
  prewarmCount((p) => p.op === "restore" && p.ok === true) +
  " restore_miss=" + prewarmCount((p) => p.op === "restore" && p.ok === false) +
  " prefill_done=" + prewarmCount((p) => p.op === "done") +
  " snapshot_saved=" + prewarmCount((p) => p.op === "snapshot_save" && p.ok === true) +
  " system_only_template=" + prewarmCount((p) => p.reason === "system_only_template"));
console.log("PREWARM_PARSE: unparsed=" + unparsedPrewarmLines +
  (unparsedPrewarmLines > 0 ? " FAIL" : " PASS"));
if (unparsedPrewarmLines > 0) anyCriterionFailed = true;
// A prewarm that never ran reads exactly like one that ran and failed, unless
// the stops are counted: a dispose, a live chat KV, a backgrounded app and an
// exhausted retry budget all produce zero restore lines and zero prefills.
// Without this, restore_ok=0 gets read as "the diagnosis is wrong".
const stops = ["stale", "no_context", "disposing", "kv_holds_chat",
  "background", "given_up", "not_ready", "in_flight", "already_warm"];
// already_warm is the queue gate's common case since the fg re-kick learned
// to log (nothing invalidated the prefix while backgrounded); counted here
// for symmetry with in_flight, not because the job stopped.
console.log("PREWARM_STOPS: " + stops.map((r) =>
  r + "=" + prewarmCount((p) => p.op === "skip" && p.reason === r)).join(" ") +
  " restore_aborted=" + prewarmCount((p) =>
    p.op === "restore" && p.ok === false && p.reason === "aborted"));
// The send path logs a hash comparison WITHOUT an "op" field, which is why
// PREWARM_STOPS above never saw it. prefix_miss is THE failure shape of the
// whole feature: the prewarm reported restore/done while having warmed a
// prefix the send did not hash — the entire prefill wasted, with every other
// counter looking perfect. kv_holds_chat on match:false is NOT a defect: the
// KV held a chat, so the static prefix was deliberately not what was cached.
const prefixMisses = prewarmCount((p) => p.match === false && p.reason === "prefix_miss");
const matchKvHolds = prewarmCount((p) => p.match === false && p.reason === "kv_holds_chat");
console.log("PREFIX_MATCH: miss=" + prefixMisses + " kv_holds_chat=" + matchKvHolds);
const cycleWindows = [];
let currentCycle = { number: null, lines: [] };
let sawCycleMarker = false;
for (const line of evLines) {
  const marker = line.match(/KALSA_RP_MARK(?::)?\s+cycle=(\d+)\b/);
  if (marker) {
    sawCycleMarker = true;
    if (currentCycle.lines.length > 0) cycleWindows.push(currentCycle);
    currentCycle = { number: +marker[1], lines: [] };
  } else {
    currentCycle.lines.push(line);
  }
}
if (currentCycle.lines.length > 0 || cycleWindows.length === 0) {
  cycleWindows.push(currentCycle);
}
if (!sawCycleMarker) cycleWindows[0].number = 1;

const rows = [];
const cycleStats = [];
for (const cycle of cycleWindows) {
  const cycleRows = [...cycle.lines.join("\n").matchAll(
    /embd=(\d+) text_tokens=(\d+) n_common=(\d+)/g,
  )]
    .map((m) => ({
      embd: +m[1],
      text: +m[2],
      common: +m[3],
      cycle: cycle.number,
    }))
    .filter((r) => r.embd > 0);
  const mismatchFields = [
    ...cycle.lines.join("\n").matchAll(
      /"op":"restore","ok":false,"reason":"meta_mismatch:([^"]+)"/g,
    ),
  ].map((m) => m[1]);
  const cold = cycleRows.some((r) => r.common === 0) && mismatchFields.length > 0;
  cycleStats.push({ ...cycle, rows: cycleRows, mismatchFields, cold });
  rows.push(...cycleRows.map((row) => ({ ...row, cold })));
}
// KV_PER_CYCLE is instrumentation only. promptMs is the only telemetry value
// that can independently contradict n_common: it measures prompt work rather
// than the cache counter itself. The other fields do not answer that question:
// tokensEvaluated is prompt size and includes cache hits (src/engine/turnTelemetry.ts:131),
// tokensCached is n_past after completion rather than n_common, and decode/MTP
// timings describe generation, not prompt evaluation. No threshold is applied
// here; the owner will calibrate one from the first real device run on this
// device. If a cycle has multiple telemetry lines, the last one wins; the
// protocol sends one turn per cycle, so normally there is only one.
const promptMsForCycle = (cycle) => {
  const telemetryPrefix = "KALSA_TELEMETRY ";
  const telemetryLines = cycle.lines.filter((line) => line.includes(telemetryPrefix));
  const last = telemetryLines.at(-1);
  if (!last) return null;
  const start = last.indexOf(telemetryPrefix);
  try {
    const payload = JSON.parse(last.slice(start + telemetryPrefix.length).trim());
    return typeof payload.promptMs === "number" &&
      Number.isFinite(payload.promptMs) && payload.promptMs >= 0
      ? payload.promptMs
      : null;
  } catch {
    return null;
  }
};
if (!rows.length) {
  console.log("KV_PREFIX: no KALSA_KVPREFIX line with a live cache");
  // Evidence without a live cache never measured the reuse question, and a
  // missing criterion read like a pass-by-silence: three sections, no
  // verdict. Same philosophy as the empty-evidence exit — a run that did not
  // measure is not a run that passed — but it stays a PRINTED criterion
  // (exit 1 through the contract below), distinct from exit 2: "no
  // measurement in this run" is not the same fact as "no evidence at all".
  // Unlike FG_REKICK there is no legitimate protocol mode that skips the KV
  // diag, so silence cannot mean "not exercised" here — it means "no
  // measurement".
  anyCriterionFailed = true;
  console.log("KV_PREFIX_CRITERION: FAIL (no live-cache measurement in this run)");
}
else {
  const whole = rows.filter((r) => r.common === r.embd).length;
  // A cycle that reused 900 of 1832 is neither a whole reuse nor a total loss,
  // and counting only the two extremes let a run where most cycles reused a
  // quarter of the cache satisfy "whole_cache_reused >= 1 && total_loss == 0".
  // On a hybrid a partial match IS the failure: seq_rm cannot roll back, so
  // the engine clears and re-prefills everything.
  const partial = rows.filter((r) => r.common > 0 && r.common < r.embd).length;
  const measuredCycles = cycleStats.filter((cycle) => cycle.rows.length > 0);
  const coldCycles = measuredCycles.filter((cycle) => cycle.cold);
  const firstColdCycles = coldCycles.filter((cycle) => cycle.number === 1);
  const lateColdCycles = coldCycles.filter((cycle) => cycle.number !== 1);
  // A meta mismatch proves that a snapshot for another configuration was on
  // disk. Only cycle 1 is the announced identity transition; a later one is a
  // runtime engine recreation and its zero remains a total loss.
  const lost = rows.filter((row) =>
    row.common === 0 && !(row.cold && row.cycle === 1),
  ).length;
  const fields = (cycles) => [...new Set(cycles.flatMap((cycle) => cycle.mismatchFields))];
  const coldFields = fields(firstColdCycles);
  const lateColdFields = fields(lateColdCycles);
  const best = rows.reduce((a, b) => (b.common > a.common ? b : a));
  const smallest = rows.reduce((a, b) => (b.embd < a.embd ? b : a));
  console.log("KV_PREFIX: rows=" + rows.length + " whole_cache_reused=" + whole +
    " partial_reuse=" + partial +
    " total_loss=" + lost +
    " cold_start=" + firstColdCycles.length +
    " cold_start_field=" + (coldFields.join(",") || "none") +
    " late_cold_start=" + lateColdCycles.length +
    " late_cold_start_field=" + (lateColdFields.join(",") || "none") +
    " best n_common=" + best.common + " embd=" + best.embd +
    " text_tokens=" + best.text + " min_embd=" + smallest.embd);
  for (const cycle of measuredCycles) {
    const row = cycle.rows.at(-1);
    const className = row.common === 0 && cycle.cold && cycle.number === 1
      ? "cold_start"
      : row.common === row.embd
        ? "whole"
        : row.common === 0
          ? "total_loss"
          : "partial";
    const promptMs = promptMsForCycle(cycle);
    console.log("KV_PER_CYCLE: cycle=" + (cycle.number ?? "unmarked") +
      " embd=" + row.embd + " text=" + row.text + " n_common=" + row.common +
      " promptMs=" + (promptMs ?? "n/a") + " class=" + className);
  }
  // The criterion, stated by the script so it cannot be misread off four
  // counters: every cycle reused its whole cache, except for one demonstrated
  // cycle-1 cold start; a prewarm actually ran; and the send hashed the prefix
  // that was warmed — a prefix_miss is a run-level failure even when the
  // n_common counters look perfect.
  // Written before the data, deliberately more severe than "at least one good
  // cycle" — a run is not a pass because one of its cycles was.
  const ran = prewarmCount((p) => p.op === "restore" && p.ok === true) +
    prewarmCount((p) => p.op === "done");
  const fails = [];
  if (whole < 1) fails.push("no cycle reused the whole cache");
  if (partial > 0) fails.push("partial reuse x" + partial);
  if (lost > 0) fails.push("total loss x" + lost);
  if (lateColdCycles.length > 0) {
    fails.push(
      "identity changed during run: " +
        lateColdCycles
          .map((cycle) =>
            cycle.mismatchFields
              .map((field) => `meta_mismatch:${field} at cycle ${cycle.number}`)
              .join(", "),
          )
          .join("; "),
    );
  }
  if (measuredCycles.length > 0 && coldCycles.length === measuredCycles.length) {
    fails.push("all cycles were cold starts; identity never stabilized");
  }
  if (ran < 1) fails.push("no prewarm restore or prefill happened");
  if (prefixMisses > 0) fails.push("prefix hash miss on the send path x" + prefixMisses);
  if (fails.length > 0) anyCriterionFailed = true;
  console.log("KV_PREFIX_CRITERION: " + (fails.length ? "FAIL (" + fails.join("; ") + ")" : "PASS"));
}
// KV_DIVERGE is instrumentation, not another criterion. KV_PREFIX_CRITERION
// already fails on partial reuse, and a context-window slide deliberately
// dropping history is a legitimate partial-reuse case, so another criterion
// here would create false FAILs. The native dump is a fixed diagnostic window:
// lo_back = n_common - shared_lo is 8 in all 38 measured rows, and
// text_fwd = text_hi - n_common is 12 in all 38, so neither is a count of
// sequence tokens. embd_fwd = embd_hi - n_common is 12 in 31 rows, 3 in 6,
// and 5 in 1. A value below 12 means the live cache ended inside the window;
// the exact cache tail is in KALSA_KVPREFIX's embd - n_common, not here.
const kvDiverges = [];
let lastKvDiverge = null;
for (const line of evLines) {
  const row = line.match(
    /KALSA_KVDIVERGE\s+n_common=(\d+)\s+shared_lo=\d+\s+embd_hi=(\d+)\s+text_hi=\d+/,
  );
  if (row) {
    lastKvDiverge = {
      common: +row[1],
      embdHi: +row[2],
      embdIds: null,
    };
    kvDiverges.push(lastKvDiverge);
  }
  const ids = line.match(/KALSA_KVDIVERGE\s+ids\b.*?(embd=\[[^\]]*(?:\]|$))/);
  if (ids && lastKvDiverge) lastKvDiverge.embdIds = ids[1];
}
if (kvDiverges.length === 0) {
  console.log("KV_DIVERGE: no KALSA_KVDIVERGE rows");
} else {
  const ended = kvDiverges.filter((row) => row.embdHi - row.common < 12);
  const endedCounts = new Map();
  for (const row of ended) {
    const after = row.embdHi - row.common;
    endedCounts.set(after, (endedCounts.get(after) ?? 0) + 1);
  }
  const endedSummary = [...endedCounts]
    .sort(([a], [b]) => a - b)
    .map(([after, count]) => after + " x" + count)
    .join(", ");
  console.log("KV_DIVERGE: rows=" + kvDiverges.length +
    " cache_ended_inside_window=" + ended.length +
    (endedSummary ? " cache_ended_after=" + endedSummary : ""));
  if (ended.length === 0) {
    console.log("KV_DIVERGE: all rows saturated the 12-token window; rows carry no end-of-cache evidence");
  } else {
    for (const row of ended) {
      console.log("KV_DIVERGE_END: cache_ended_after=" + (row.embdHi - row.common) +
        " n_common=" + row.common + " embd_hi=" + row.embdHi +
        (row.embdIds ? " " + row.embdIds : ""));
    }
  }
}
console.log("KV_FALLBACK: checkpoint_recover=" + n(/KALSA_KVREUSE checkpoint/g) +
  " no_usable_checkpoint=" + n(/KALSA_KVDIAG /g));

// ── Foreground re-kick ────────────────────────────────────────────────────
// The protocol's fg bounce (rp_fg_bounce) opens each kick window with an
// `fg_kick` marker and CLOSES it with `fg_settled`, emitted as the bounce's
// last line: each kick is classified by the prewarm lines from `fg_kick` up
// to the next KALSA_RP_MARK (or EOF) — in practice fg_settled, which seals
// the window before the send starts producing prewarm lines of its own. The
// closing marker is not decoration: without it the window would run to the
// next cycle's marker and a mute kick would read as served off the send's
// `{"op":"done"}`. The shell script and this section are one contract, not
// two independent files. One line per question, the criterion stated by the
// script so it cannot be misread off six counters.
const kickWindows = [];
for (let i = 0; i < evLines.length; i++) {
  if (!/KALSA_RP_MARK.*fg_kick/.test(evLines[i])) continue;
  let j = i + 1;
  while (j < evLines.length && !evLines[j].includes("KALSA_RP_MARK")) j++;
  kickWindows.push(evLines.slice(i + 1, j).join("\n"));
}
if (kickWindows.length === 0) {
  // A run that never tried the foreground (old evidence, or FG_BOUNCE=0) is
  // not a failed run — it is a run that did not measure this question.
  // Printing FAIL here would make the verdict useless, printing nothing
  // would look like the section vanished; so one line, no criterion, and the
  // exit code stays out of it.
  console.log("FG_REKICK: not exercised — no fg_kick markers in this evidence");
} else {
  // One class per kick, priority order: served wins over warm over held over
  // stopped over no_work over too_early; a kick with NO KALSA_PREWARM line at
  // all is silent — exactly the hole this section exists to find.
  // `served` demands COMPLETED work: a prefill done, or a restore that
  // landed. `start` logs at QUEUE time, before the job has run one step, and
  // `restore ok:false` exits before any prefill — either without a
  // completion after it is `no_work`: the re-kick fired and warmed nothing.
  // A bare start must never dress a kick as served.
  // `stopped` READS the reason off the line, known to this script or not,
  // and the criterion names it: the app emits far more skip reasons than any
  // list here could track, so the list lives in the app and the verdict only
  // reads. A reason new to the app must fail loudly saying its name — not
  // pass, and not be swallowed as "no prewarm line" when the line is right
  // there. not_ready after 20s in the background, for instance, is the model
  // evicted while backgrounded (thermal pause / onTrimMemory in
  // kalsa-lifecycle) — a model-lifecycle problem, not a missing re-kick.
  // `warm` is a WEAK pass: it says the re-kick reached the queue gate and
  // found the prefix already warm (or a prewarm already in flight) — it does
  // NOT say the native KV is reusable. That question stays with
  // KV_PREFIX_CRITERION, which reads KALSA_KVPREFIX / n_common.
  const classify = (w) => {
    const events = prewarmEventsIn(w);
    if (events.some((p) => p.op === "done") ||
      events.some((p) => p.op === "restore" && p.ok === true)) {
      return { cls: "served" };
    }
    if (events.some((p) => p.op === "skip" &&
      (p.reason === "already_warm" || p.reason === "in_flight"))) {
      return { cls: "warm" };
    }
    if (events.some((p) => p.op === "skip" && p.reason === "kv_holds_chat")) {
      return { cls: "held" };
    }
    const skipReason = events.find((p) => p.op === "skip")?.reason;
    if (skipReason) {
      if (skipReason === "background") return { cls: "too_early" };
      return { cls: "stopped", reason: skipReason };
    }
    if (events.some((p) => p.op === "restore" && p.ok === false)) {
      return { cls: "no_work", form: "restore did not complete" };
    }
    if (events.some((p) => p.op === "start")) {
      return { cls: "no_work", form: "queued but no outcome" };
    }
    // A KALSA_PREWARM line of an op this verdict does not know: fail naming
    // that, never as "no prewarm line" — the line is right there.
    if (w.includes("KALSA_PREWARM")) {
      return { cls: "stopped", reason: "unrecognised prewarm line" };
    }
    return { cls: "silent" };
  };
  const count = { served: 0, warm: 0, held: 0, stopped: 0, no_work: 0, too_early: 0, silent: 0 };
  const stoppedBy = {};
  const noWorkBy = {};
  for (const w of kickWindows) {
    const hit = classify(w);
    count[hit.cls] += 1;
    if (hit.cls === "stopped") stoppedBy[hit.reason] = (stoppedBy[hit.reason] ?? 0) + 1;
    if (hit.cls === "no_work") noWorkBy[hit.form] = (noWorkBy[hit.form] ?? 0) + 1;
  }
  console.log("FG_REKICK: kicks=" + kickWindows.length +
    " served=" + count.served + " warm=" + count.warm + " held=" + count.held +
    " stopped=" + count.stopped + " no_work=" + count.no_work +
    " too_early=" + count.too_early + " silent=" + count.silent);
  const fgFails = [];
  const stoppedNames = Object.keys(stoppedBy);
  if (count.stopped > 0) {
    fgFails.push("re-kick stopped: " +
      stoppedNames.map((r) => r + " x" + stoppedBy[r]).join("; "));
  }
  const noWorkForms = ["restore did not complete", "queued but no outcome"];
  if (count.no_work > 0) {
    fgFails.push("re-kick fired but warmed nothing: " +
      noWorkForms.filter((f) => noWorkBy[f])
        .map((f) => f + " x" + noWorkBy[f]).join("; "));
  }
  if (count.too_early > 0) {
    fgFails.push("re-kick queued while the app was still backgrounded x" + count.too_early);
  }
  if (count.silent > 0) {
    fgFails.push("re-kick produced no prewarm line x" + count.silent);
  }
  if (fgFails.length > 0) anyCriterionFailed = true;
  console.log("FG_REKICK_CRITERION: " +
    (fgFails.length ? "FAIL (" + fgFails.join("; ") + ")" : "PASS"));
}
// The verdict's own status, per the contract at the top: 0 = every printed
// criterion passed, 1 = a printed criterion failed, 2 = no evidence. The
// protocol runs this under `set -o pipefail`, so a 1 propagates to the run.
process.exit(anyCriterionFailed ? 1 : 0);
