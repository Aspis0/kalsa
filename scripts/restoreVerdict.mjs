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
console.log("PREFIX_PREWARM: restore_ok=" + n(/"op":"restore","ok":true/g) +
  " restore_miss=" + n(/"op":"restore","ok":false/g) +
  " prefill_done=" + n(/"op":"done"/g) +
  " snapshot_saved=" + n(/"op":"snapshot_save","ok":true/g) +
  " system_only_template=" + n(/"reason":"system_only_template"/g));
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
  r + "=" + n(new RegExp("\"op\":\"skip\",\"reason\":\"" + r + "\"", "g"))).join(" ") +
  " restore_aborted=" + n(/"op":"restore","ok":false,"reason":"aborted"/g));
// The send path logs a hash comparison WITHOUT an "op" field, which is why
// PREWARM_STOPS above never saw it. prefix_miss is THE failure shape of the
// whole feature: the prewarm reported restore/done while having warmed a
// prefix the send did not hash — the entire prefill wasted, with every other
// counter looking perfect. kv_holds_chat on match:false is NOT a defect: the
// KV held a chat, so the static prefix was deliberately not what was cached.
const prefixMisses = n(/"match":false,"reason":"prefix_miss"/g);
const matchKvHolds = n(/"match":false,"reason":"kv_holds_chat"/g);
console.log("PREFIX_MATCH: miss=" + prefixMisses + " kv_holds_chat=" + matchKvHolds);
const rows = [...ev.matchAll(/embd=(\d+) text_tokens=(\d+) n_common=(\d+)/g)]
  .map((m) => ({ embd: +m[1], text: +m[2], common: +m[3] }))
  .filter((r) => r.embd > 0);
if (!rows.length) {
  console.log("KV_PREFIX: no KALSA_KVPREFIX line with a live cache");
  // Evidence without a live cache never measured the reuse question, and a
  // missing criterion read like a pass-by-silence: three sections, no
  // verdict. Same philosophy as the empty-evidence exit above — but here the
  // criteria PRINT and the exit code stays out of it; the only non-zero exit
  // remains the empty evidence. Unlike FG_REKICK there is no legitimate
  // protocol mode that skips the KV diag, so silence cannot mean "not
  // exercised" here — it means "no measurement".
  console.log("KV_PREFIX_CRITERION: FAIL (no live-cache measurement in this run)");
}
else {
  const whole = rows.filter((r) => r.common === r.embd).length;
  const lost = rows.filter((r) => r.common === 0).length;
  // A cycle that reused 900 of 1832 is neither a whole reuse nor a total loss,
  // and counting only the two extremes let a run where most cycles reused a
  // quarter of the cache satisfy "whole_cache_reused >= 1 && total_loss == 0".
  // On a hybrid a partial match IS the failure: seq_rm cannot roll back, so
  // the engine clears and re-prefills everything.
  const partial = rows.filter((r) => r.common > 0 && r.common < r.embd).length;
  const best = rows.reduce((a, b) => (b.common > a.common ? b : a));
  const smallest = rows.reduce((a, b) => (b.embd < a.embd ? b : a));
  console.log("KV_PREFIX: rows=" + rows.length + " whole_cache_reused=" + whole +
    " partial_reuse=" + partial +
    " total_loss=" + lost + " best n_common=" + best.common + " embd=" + best.embd +
    " text_tokens=" + best.text + " min_embd=" + smallest.embd);
  // The criterion, stated by the script so it cannot be misread off four
  // counters: every cycle reused its whole cache, a prewarm actually ran,
  // and the send hashed the prefix that was warmed — a prefix_miss is a
  // run-level failure even when the n_common counters look perfect.
  // Written before the data, deliberately more severe than "at least one good
  // cycle" — a run is not a pass because one of its cycles was.
  const ran = n(/"op":"restore","ok":true/g) + n(/"op":"done"/g);
  const fails = [];
  if (whole < 1) fails.push("no cycle reused the whole cache");
  if (partial > 0) fails.push("partial reuse x" + partial);
  if (lost > 0) fails.push("total loss x" + lost);
  if (ran < 1) fails.push("no prewarm restore or prefill happened");
  if (prefixMisses > 0) fails.push("prefix hash miss on the send path x" + prefixMisses);
  console.log("KV_PREFIX_CRITERION: " + (fails.length ? "FAIL (" + fails.join("; ") + ")" : "PASS"));
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
const evLines = ev.split("\n");
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
    if (/"op":"done"/.test(w) || /"op":"restore","ok":true/.test(w)) return { cls: "served" };
    if (/"op":"skip","reason":"(already_warm|in_flight)"/.test(w)) return { cls: "warm" };
    if (w.includes('"op":"skip","reason":"kv_holds_chat"')) return { cls: "held" };
    const skipReason = w.match(/"op":"skip","reason":"([^"]*)"/);
    if (skipReason) {
      if (skipReason[1] === "background") return { cls: "too_early" };
      return { cls: "stopped", reason: skipReason[1] };
    }
    if (/"op":"restore","ok":false/.test(w)) {
      return { cls: "no_work", form: "restore did not complete" };
    }
    if (/"op":"start"/.test(w)) return { cls: "no_work", form: "queued but no outcome" };
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
  console.log("FG_REKICK_CRITERION: " +
    (fgFails.length ? "FAIL (" + fgFails.join("; ") + ")" : "PASS"));
}
