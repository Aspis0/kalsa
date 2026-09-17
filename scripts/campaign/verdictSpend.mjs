/**
 * What a T20C run SPENT, next to what verdict.mjs proves it got right.
 *
 * The checks in verdict.mjs assert the sliding window is CORRECT: boundaries
 * never go backwards, at most one align lands on zero, no answer is truncated
 * at the ceiling. None of them price it. With LFM2 the recurrent half cannot
 * evict a prefix, so a slide cannot shorten the KV — it throws it away
 * (discardChatKvForWindowSlideLocked in src/engine/LlamaService.ts) and the
 * conversation is prefilled again from scratch. On the 2026-09-17 run that was
 * 4954 tokens in 207 s for one slide, plus the system prompt re-prewarmed.
 *
 * What this does NOT claim: that the re-prefill is what made the phone hot.
 * An earlier version of this comment said so and the same run refutes it —
 * `health device <pid> 3` appears at turn 3, about eight minutes BEFORE that
 * prefill ran. The bill was paid by an already-throttled phone. Nor was the
 * run a "plain chat": tools were on (`toolCount:5`).
 *
 * `prompt_n` is what the engine actually computed, cache hits excluded, so it
 * is the honest bill; `tokensEvaluated` counts the whole prompt and would
 * flatter a cache that did no work.
 *
 * REPORTED, NEVER GATED. What counts as too expensive is a product line, not
 * a number this file may invent.
 */

const SLIDE = "KALSA_WINDOW_SLIDE";
const TURN = "KALSA_TELEMETRY";
const PREWARM = "KALSA_PREWARM";

/**
 * Missing counters are encoded as -1, not as absent
 * (src/engine/turnTelemetry.ts: `promptMs: timings?.prompt_ms ?? -1`), and -1
 * IS finite — so `Number.isFinite` alone is not a guard. It let the sentinel
 * through and printed "-1 tok in -0s" while quietly subtracting from a total.
 * A real zero carries no information here either: a prefill that computed
 * nothing costs nothing, and a decode rate of 0 is not a rate.
 */
function measured(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

/**
 * React Native renders a multi-argument `console.log` with quotes around each
 * argument — `KALSA_PREWARM', '{"op":"done",...}'` — so slicing from the first
 * brace to the end of the line and parsing it throws on a perfectly good line.
 * Slice brace-to-last-brace instead, which reads both that shape and the
 * single-argument template form the other markers use.
 */
function payloadOn(line, marker) {
  const at = line.indexOf(marker);
  if (at === -1) return null;
  const open = line.indexOf("{", at);
  const close = line.lastIndexOf("}");
  if (open === -1 || close <= open) return null;
  try {
    const parsed = JSON.parse(line.slice(open, close + 1));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** Markers in file order — the bill has to know which turn followed a slide. */
function readEvents(logcat) {
  const events = [];
  for (const line of logcat.split("\n")) {
    for (const [kind, marker] of [
      ["slide", SLIDE],
      ["turn", TURN],
      ["prewarm", PREWARM],
    ]) {
      const payload = payloadOn(line, marker);
      if (payload) events.push({ kind, payload });
    }
  }
  return events;
}

/**
 * The re-prefill each KV-clearing slide handed to the turn that followed it.
 * A turn pays at most ONE slide: without the cursor, two slides with no turn
 * between them both bill the same line and the run looks twice as expensive
 * as it was.
 */
function slideBills(events) {
  const bills = [];
  let cursor = 0;
  for (let i = 0; i < events.length; i += 1) {
    if (events[i].kind !== "slide" || !events[i].payload.kvCleared) continue;
    let j = Math.max(i + 1, cursor);
    while (j < events.length && events[j].kind !== "turn") j += 1;
    if (j >= events.length) {
      bills.push("slide with no turn after it");
      continue;
    }
    cursor = j + 1;
    const tokens = measured(events[j].payload.prompt_n);
    const ms = measured(events[j].payload.promptMs);
    bills.push(
      tokens !== null && ms !== null
        ? `${tokens} tok in ${(ms / 1000).toFixed(0)}s`
        : "turn after the slide reported no prefill counters",
    );
  }
  return bills;
}

export function spend(logcat) {
  const events = readEvents(logcat);
  const turns = events.filter((e) => e.kind === "turn").map((e) => e.payload);

  const total = (list, key) =>
    list.reduce((acc, p) => acc + (measured(p[key]) ?? 0), 0);

  // The prewarm computes the system prompt, and it re-runs after every KV
  // clear (it logs {"op":"skip","reason":"kv_holds_chat"} when it can skip).
  // It is device prompt-eval time like any other: 152 s of it on the
  // 2026-09-17 run, which is why leaving it out understated prefill by 6 pts.
  const prewarmDone = events
    .filter((e) => e.kind === "prewarm" && e.payload.op === "done")
    .map((e) => e.payload);
  const prefillMs = total(turns, "promptMs") + total(prewarmDone, "promptMs");
  const decodeMs = total(turns, "predictedMs");

  // Round 0 only: later rounds of a tool-using turn would mix a tool round's
  // rate into a first-vs-last comparison that reads like turn-over-turn decay.
  const rates = turns
    .filter((p) => (p.round ?? 0) === 0)
    .map((p) => measured(p.predictedPerSecond))
    .filter((r) => r !== null);

  const wall = prefillMs + decodeMs;
  const bills = slideBills(events);
  const decay =
    rates.length >= 2
      ? `${rates[0].toFixed(2)} -> ${rates[rates.length - 1].toFixed(2)} (${Math.round((100 * (rates[rates.length - 1] - rates[0])) / rates[0])}%)`
      : rates.length === 1
        ? rates[0].toFixed(2)
        : "no decode rate reported";

  return {
    "prefill vs decode": wall
      ? `${(prefillMs / 1000).toFixed(0)}s prefill (${(total(prewarmDone, "promptMs") / 1000).toFixed(0)}s of it prewarm) / ${(decodeMs / 1000).toFixed(0)}s decode (prefill ${Math.round((100 * prefillMs) / wall)}%)`
      : "no turn reported timings",
    "decode tok/s round 0, first -> last": decay,
    // Named for the marker it reads: a KV clear announced only by
    // KALSA_SESSION window_slide/window_reconcile is not priced here, and
    // saying "no slide cleared the KV" would read like good news.
    "re-prefill after a KALSA_WINDOW_SLIDE that cleared the KV": bills.length
      ? bills.join(", ")
      : "none in this run",
  };
}
