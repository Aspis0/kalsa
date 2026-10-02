// How one `brain_progress` tuning step becomes the bar's numbers: the fields
// src-tauri/src/startup.rs sends (Progress::Tuning) and nothing else, with no
// clock inside it — scripts/verify.mjs pins the mapping, including the rules
// the bar and its line must never break: full only when the tune's own report
// says the plan ran to the end (a `cut` report never says that), a stop that
// still owes a next start named as such (and one that does not named for what
// it kept), no wait shown before there are two candidates to average, and no
// estimate that has already been exceeded.

/** The tuning half of a `brain_progress` step, as the page reads it. */
export interface TuningStep {
  kind?: string;
  done?: number;
  total?: number;
  candidate?: number;
  cut?: boolean;
  retry_next?: boolean;
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
}

/** What the line under the bar says about the wait, once two candidates
    have finished for it to average. */
export type TuneWait =
  | { kind: "cut" }
  | { kind: "kept" }
  | { kind: "minutes"; minutes: number }
  | { kind: "almost" };

/** Below this many seconds left, the honest wait is "any moment now"
    rather than a minute figure that would be wrong by the time it is read. */
const ALMOST_SECONDS = 30;

/** Two finished candidates before any wait is shown: one sample anchors an
    estimate to whatever that candidate happened to cost. */
const MINIMUM_SAMPLES = 2;

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

/** The wait under the bar. The stop's two answers come first — a cut that
    still owes a next start, or one whose verdict was saved and kept — and
    then the estimate: `wholeSeconds` over the candidates measured so far
    (the running one's share counted in both) is the rate one candidate
    really costs on THIS tune, and it moves in small steps as each
    candidate finishes instead of jumping at the boundary the way a mean
    of only the finished ones does. Hidden until two candidates have
    finished — one sample anchors it to whatever that candidate cost — and
    never a figure already exceeded: under half a minute left is "any
    moment now". */
export function tuneWait(
  face: TuneFace,
  share: number,
  wholeSeconds: number,
  finished: number,
): TuneWait | null {
  if (face.cut) return face.retryNext ? { kind: "cut" } : { kind: "kept" };
  if (finished < MINIMUM_SAMPLES || face.total <= 0 || face.done >= face.total) return null;
  const running = Math.min(Math.max(share, 0), 1);
  const rate = wholeSeconds / (finished + running);
  if (!(rate > 0)) return null; // nothing measured in time yet
  const remaining = (face.total - face.done - running) * rate;
  if (remaining < ALMOST_SECONDS) return { kind: "almost" };
  return { kind: "minutes", minutes: Math.max(1, Math.round(remaining / 60)) };
}
