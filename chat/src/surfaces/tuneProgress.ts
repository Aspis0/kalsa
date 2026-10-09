// How one `brain_progress` tuning step becomes the bar's numbers: the fields
// src-tauri/src/startup.rs sends (Progress::Tuning) and nothing else, with no
// clock inside it — scripts/verify.mjs pins the mapping, including the rules
// the bar and its line must never break: full only when the tune's own report
// says the plan ran to the end (a `cut` report never says that), a stop that
// still owes a next start named as such (and one that does not named for what
// it kept), a wait from the first test — said as the budget's CEILING, where
// nothing has been averaged yet — one that never climbs inside one tune, and
// no figure at all once the budget is spent.

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
    the budget's ceiling where nothing has been averaged yet, the minutes
    left, or the last half minute before its end. */
export type TuneWait =
  | { kind: "cut" }
  | { kind: "kept" }
  | { kind: "standard" }
  | { kind: "ceiling"; minutes: number }
  | { kind: "minutes"; minutes: number }
  | { kind: "almost" };

/** Below this many seconds left, the honest wait is "any moment now"
    rather than a minute figure that would be wrong by the time it is read. */
const ALMOST_SECONDS = 30;

/** Two finished candidates before the wait is an average of them: one
    sample anchors an estimate to whatever that candidate happened to cost,
    and below two the budget's ceiling answers alone. */
const MINIMUM_SAMPLES = 2;

/** What the ceiling adds to the budget for the one lifetime that may be
    running past it: kalsa-tune stops a lifetime from BEGINNING past the
    budget and never kills one mid-measurement, naming a lifetime's ready
    deadline (READY_TIMEOUT) as the overshoot — a lifetime may run on past
    even that (`crates/kalsa-tune/src/measure/mod.rs`). So the number is
    said as "about", never as a bound, and the budget's passing drops to
    "any moment now". */
const LIFETIME_SLACK_SECONDS = 120;

/** The line's own high-water: the figure it last showed is the most it may
    show again, so a candidate that closes slower than the ones behind it
    cannot wind the number up. A fresh tune passes none. */
function held(minutes: number, shown: number | null | undefined): number {
  return typeof shown === "number" && Number.isFinite(shown) ? Math.min(minutes, shown) : minutes;
}

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
    all, where the rule stands — and then the figure. Before two candidates
    have finished there is nothing to average, so the budget — the point no
    lifetime BEGINS past — plus one lifetime's slack is a CEILING, said as
    "about". From two on, the smaller of that ceiling and the estimate
    (`wholeSeconds` over the candidates measured so far, the running one's
    share counted in both, which is the rate one candidate really costs on
    THIS tune) answers. Once the budget's seconds are spent, no figure is
    honest at all: a lifetime that began inside it runs on to its own
    limits, so the line says "any moment now" and nothing numeric — as it
    does under half a minute left. `shownMinutes` is the figure this tune
    has already put on screen, and none of them is exceeded. */
export function tuneWait(
  face: TuneFace,
  share: number,
  wholeSeconds: number,
  finished: number,
  budgetSeconds?: number,
  shownMinutes?: number | null,
): TuneWait | null {
  if (face.cut) {
    if (face.retryNext) return { kind: "cut" };
    return face.keptWinner ? { kind: "kept" } : { kind: "standard" };
  }
  if (face.total <= 0 || face.done >= face.total) return null;
  const budget = whole(budgetSeconds);
  if (budget > 0 && wholeSeconds >= budget) return { kind: "almost" };
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
  const bound = budget > 0 ? budget + LIFETIME_SLACK_SECONDS - wholeSeconds : null;
  if (estimate === null) {
    if (bound === null) return null;
    return { kind: "ceiling", minutes: held(Math.max(1, Math.ceil(bound / 60)), shownMinutes) };
  }
  const left = bound === null ? estimate : Math.min(estimate, bound);
  if (left < ALMOST_SECONDS) return { kind: "almost" };
  return { kind: "minutes", minutes: held(Math.max(1, Math.round(left / 60)), shownMinutes) };
}
