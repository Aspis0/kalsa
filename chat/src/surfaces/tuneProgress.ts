// How one `brain_progress` tuning step becomes the bar's numbers: the fields
// src-tauri/src/startup.rs sends (Progress::Tuning) and nothing else, with no
// clock inside it — scripts/verify.mjs pins the mapping, including the rules
// the bar and its line must never break: full only when the tune's own report
// says the plan ran to the end (a `cut` report never says that), a stop that
// still owes a next start named as such (and one that does not named for what
// it kept), a wait from the first test on the budget where no average exists
// yet, one that never climbs while a candidate runs, and no figure that has
// already been exceeded.

/** The tuning half of a `brain_progress` step, as the page reads it. */
export interface TuningStep {
  kind?: string;
  done?: number;
  total?: number;
  candidate?: number;
  cut?: boolean;
  retry_next?: boolean;
  kept_winner?: boolean;
  /** The tune's budget in whole seconds: no lifetime begins past it, so it
      is the one end the page may name before it has anything to average. */
  budget_seconds?: number;
}

/** The tune as the bar reads it. `candidate` is 1-based; a report whose
    `candidate` counts itself in closes the candidate it names (or only
    lowers the plan), one behind it starts it. `cut` means the budget
    stopped the tune short of `total` — the rest is owed to a later start
    unless `retryNext` says this run already spent that retry and its
    verdict was saved as a record. */
export interface TuneFace {
  done: number;
  total: number;
  candidate: number;
  closing: boolean;
  cut: boolean;
  retryNext: boolean;
  /** The verdict ended WITH a winner: only then may the stop's line say
      something was kept — otherwise the rule stands and says so. */
  keptWinner: boolean;
}

/** What the line under the bar says about the wait: the stop's three words,
    the minutes left, or the last half minute before its end. */
export type TuneWait =
  | { kind: "cut" }
  | { kind: "kept" }
  | { kind: "standard" }
  | { kind: "minutes"; minutes: number }
  | { kind: "almost" };

/** Below this many seconds left, the honest wait is "any moment now"
    rather than a minute figure that would be wrong by the time it is read. */
const ALMOST_SECONDS = 30;

/** Two finished candidates before the wait is an average of them: one
    sample anchors an estimate to whatever that candidate happened to cost,
    and below two the budget alone answers. */
const MINIMUM_SAMPLES = 2;

/** What the budget gets on top before the page calls it an end: kalsa-tune
    stops a lifetime from BEGINNING past the budget and never kills one
    mid-measurement, and it names a lifetime's ready deadline (READY_TIMEOUT)
    as the bound on what one that began at the bound can overrun
    (`crates/kalsa-tune/src/measure/mod.rs`). A tune that outlives even that
    is answered as "any moment now", never as a figure. */
const LIFETIME_SLACK_SECONDS = 120;

/** A count that may be missing or nonsense: zero, whole, never below. */
function whole(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

/** `null` for any step that is not the tune: the other phases carry no
    counts, and their bar is the indeterminate one. */
export function tuneFace(step: TuningStep): TuneFace | null {
  if (step.kind !== "tuning") return null;
  const total = whole(step.total);
  const done = Math.min(whole(step.done), total);
  const candidate = typeof step.candidate === "number" && Number.isFinite(step.candidate)
    ? Math.max(0, Math.trunc(step.candidate))
    : done + 1;
  return {
    done,
    total,
    candidate,
    closing: candidate <= done,
    cut: step.cut === true,
    retryNext: step.retry_next === true,
    keptWinner: step.kept_winner === true,
  };
}

/** The test the line names: nothing to name before one has begun (a stop
    before the first candidate reports index 0 — "Test 0 of 4" would be a
    test this tune never ran). */
export function tuneAttempt(face: TuneFace): { index: number; total: number } | null {
  return face.total > 0 && face.candidate >= 1 ? { index: face.candidate, total: face.total } : null;
}

/** How far the running candidate may fill its own slot: what it has cost
    against the average of the ones behind it. A closing report has nothing
    running — the next candidate has not begun — so it answers zero. */
export function tuneShare(face: TuneFace, elapsed: number, average: number): number {
  if (face.closing || !(average > 0) || !(elapsed > 0)) return 0;
  return elapsed / average;
}

/** The bar: the candidates closed, plus the running one's share of its own
    slot. Never 100 before the report whose `done` reaches its total — the
    last percent belongs to the tune's close, so a full bar is a phase that
    is over, not one that hopes to be. A `cut` report keeps `total` at the
    original plan, so a stopped tune stays at the height it really reached. */
export function tunePercent(face: TuneFace, share: number): number {
  if (face.total <= 0) return 0;
  if (face.done >= face.total) return 100;
  const slot = Math.min(Math.max(share, 0), 0.999);
  return Math.floor(((face.done + slot) / face.total) * 100);
}

/** Whether this report may play the finish: the plan ran to its end, and
    the budget stopped nothing on the way (`cut` tunes owe the next start
    the rest — unless this run already spent that retry). */
export function tuneDone(face: TuneFace): boolean {
  return !face.cut && face.total > 0 && face.done >= face.total;
}

/** The wait under the bar. The stop's three answers come first — a cut
    that still owes a next start; one whose verdict was saved WITH a
    winner, which is what may be called kept; and one with no winner at
    all, where the rule stands — and then the figure, the smaller of two:
    `wholeSeconds` over the candidates measured so far (the running one's
    share counted in both) is the rate one candidate really costs on THIS
    tune, and it moves in small steps as each candidate finishes instead of
    jumping at the boundary the way a mean of only the finished ones does;
    the budget — the point no lifetime BEGINS past — plus that one
    lifetime's slack, less the tune's own whole seconds, is where the end
    is due, and it answers alone until two candidates have finished. Both
    only come down while one candidate runs, and neither is shown already
    exceeded: under half a minute left is "any moment now". */
export function tuneWait(
  face: TuneFace,
  share: number,
  wholeSeconds: number,
  finished: number,
  budgetSeconds?: number,
): TuneWait | null {
  if (face.cut) {
    if (face.retryNext) return { kind: "cut" };
    return face.keptWinner ? { kind: "kept" } : { kind: "standard" };
  }
  if (face.total <= 0 || face.done >= face.total) return null;
  const running = Math.max(share, 0);
  let estimate: number | null = null;
  if (finished >= MINIMUM_SAMPLES) {
    // The rate is the finished candidates' own average: `wholeSeconds`
    // carries the running candidate's seconds and this share carries its
    // fraction of one, so the two cancel. Cap the share in the divisor
    // instead and a candidate slower than the average winds the figure up
    // tick after tick, which is the clock the line must never look like.
    const rate = wholeSeconds / (finished + running);
    if (rate > 0) estimate = (face.total - face.done - Math.min(running, 1)) * rate;
  }
  const budget = whole(budgetSeconds);
  const bound = budget > 0 ? budget + LIFETIME_SLACK_SECONDS - wholeSeconds : null;
  const left = estimate === null ? bound : bound === null ? estimate : Math.min(estimate, bound);
  if (left === null) return null;
  if (left < ALMOST_SECONDS) return { kind: "almost" };
  return { kind: "minutes", minutes: Math.max(1, Math.round(left / 60)) };
}
