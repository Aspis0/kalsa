// How one `brain_progress` tuning step becomes the bar's numbers: the three
// fields src-tauri/src/startup.rs sends (Progress::Tuning) and nothing else,
// with no clock inside it — scripts/verify.mjs pins the mapping, including
// the rule the bar must never break: full only when the tune's own report
// says the plan ran to the end.

/** The tuning half of a `brain_progress` step, as the page reads it. */
export interface TuningStep {
  kind?: string;
  done?: number;
  total?: number;
  candidate?: number;
}

/** The tune as the bar reads it. `candidate` is 1-based; a report whose
    `candidate` counts itself in closes the candidate it names (or only
    lowers the plan), one behind it starts it. */
export interface TuneFace {
  done: number;
  total: number;
  candidate: number;
  closing: boolean;
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
  return { done, total, candidate, closing: candidate <= done };
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
    is over, not one that hopes to be. */
export function tunePercent(face: TuneFace, share: number): number {
  if (face.total <= 0) return 0;
  if (face.done >= face.total) return 100;
  const slot = Math.min(Math.max(share, 0), 0.999);
  return Math.floor(((face.done + slot) / face.total) * 100);
}

/** The estimate in whole minutes, once one candidate has finished: what is
    left of the average over the candidates left, the running one's own
    rest included — never zero, never shown at the end (there is nothing
    left to estimate) and never before an average exists. */
export function minutesLeft(face: TuneFace, share: number, average: number): number | null {
  if (!(average > 0) || face.total <= 0 || face.done >= face.total) return null;
  const rest = Math.min(Math.max(share, 0), 1);
  const seconds = (face.total - face.done - rest) * average;
  return Math.max(1, Math.round(seconds / 60));
}
