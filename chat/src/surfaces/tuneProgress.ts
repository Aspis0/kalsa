// How one `brain_progress` tuning step becomes the bar's numbers: the fields
// src-tauri/src/startup.rs sends (Progress::Tuning) and nothing else, with no
// clock inside it — scripts/verify.mjs pins the mapping, including the two
// rules the bar must never break: full only when the tune's own report says
// the plan ran to the end (and a `cut` report never says that), and a wait
// that cannot already have been exceeded.

/** The tuning half of a `brain_progress` step, as the page reads it. */
export interface TuningStep {
  kind?: string;
  done?: number;
  total?: number;
  candidate?: number;
  cut?: boolean;
}

/** The tune as the bar reads it. `candidate` is 1-based; a report whose
    `candidate` counts itself in closes the candidate it names (or only
    lowers the plan), one behind it starts it. `cut` means the budget
    stopped the tune short of `total` — the rest is owed to a later start. */
export interface TuneFace {
  done: number;
  total: number;
  candidate: number;
  closing: boolean;
  cut: boolean;
}

/** What the line under the bar says about the wait, once one candidate has
    an average to be measured against. */
export type TuneWait =
  | { kind: "cut" }
  | { kind: "minutes"; minutes: number }
  | { kind: "almost" };

/** Below this many seconds left, the honest wait is "any moment now"
    rather than a minute figure that would be wrong by the time it is read. */
const ALMOST_SECONDS = 30;

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
  return { done, total, candidate, closing: candidate <= done, cut: step.cut === true };
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
    the rest — the walk recorded them as a marker to retry). */
export function tuneDone(face: TuneFace): boolean {
  return !face.cut && face.total > 0 && face.done >= face.total;
}

/** The wait under the bar: null while there is nothing to average, the
    stop's own line on a cut, "any moment now" once the running candidate
    has outlived everything left to wait for — and otherwise what is left
    of the average over the candidates left. The running candidate is
    expected to take at least the average behind it AND no less than it
    has already spent, so one slow candidate pushes the estimate out and
    can never pull it under. */
export function tuneWait(face: TuneFace, share: number, average: number): TuneWait | null {
  if (face.cut) return { kind: "cut" };
  if (!(average > 0) || face.total <= 0 || face.done >= face.total) return null;
  const elapsed = Math.max(0, share) * average;
  const remaining = (face.total - face.done) * average - Math.min(elapsed, average);
  if (remaining < ALMOST_SECONDS) return { kind: "almost" };
  return { kind: "minutes", minutes: Math.max(1, Math.round(remaining / 60)) };
}
