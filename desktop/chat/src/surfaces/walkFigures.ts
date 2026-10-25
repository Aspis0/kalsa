// Figures the walk's view derives from its steps, kept pure: where the walk
// stands as one value (the tree and the bar both show it), and how long the
// model download has left.

/** Before any phase carries a fraction: a seedling. */
export const AT_REST = 0.04;
/** The engine's own download takes the walk from AT_REST to here. */
const ENGINE_DONE = 0.08;
/** The model download takes it from ENGINE_DONE to here. */
export const DOWNLOADED = 0.6;
/** The tune takes it the rest of the way, but a tune that has not finished
    stops below the blossom (treeGeometry's bloom begins at 0.93): only a
    finished tune reaches 1. */
const TUNE_SHORT = 0.92;

/** Where this step puts the walk. `pct` is the phase's own percent (null when
    the phase has none); `done` is the tune's own report that its plan ran. */
export function growthOf(kind: string, pct: number | null, done: boolean): number {
  const share = (pct ?? 0) / 100;
  if (kind === "runtime_bytes" && pct !== null) return AT_REST + (ENGINE_DONE - AT_REST) * share;
  if (kind === "model_bytes" && pct !== null) return ENGINE_DONE + (DOWNLOADED - ENGINE_DONE) * share;
  if (kind === "tuning") return done ? 1 : DOWNLOADED + (TUNE_SHORT - DOWNLOADED) * share;
  return AT_REST;
}

/** The walk's value as the bar's percent: 100 only for a finished walk. */
export function walkPercent(growth: number): number {
  return growth >= 1 ? 100 : Math.min(99, Math.floor(growth * 100));
}

/** Below this many seconds of a download phase, its rate is noise. */
const RATE_AFTER_SECONDS = 5;
/** Past this, a figure is not a wait anyone can plan around. */
export const LONGEST_MINUTES = 120;

/** Whole minutes the download has left at the rate this phase has run at,
    or null until there is a rate to speak of. `from` is what had already
    arrived when the phase began, so a resumed download is not credited with
    bytes it fetched in an earlier run. */
export function downloadMinutesLeft(from: number, done: number, total: number, seconds: number): number | null {
  const fetched = done - from;
  if (seconds < RATE_AFTER_SECONDS || fetched <= 0 || done >= total) return null;
  const rate = fetched / seconds;
  return Math.max(1, Math.ceil((total - done) / rate / 60));
}
