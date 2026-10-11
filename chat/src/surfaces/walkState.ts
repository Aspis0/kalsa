// The walk's steps as the page reads them: the Progress event `brain_progress`,
// serialised in src-tauri/src/startup.rs with the tag "kind": { kind:
// "measuring" | "deciding" | "choosing" | "tuning" }, the byte phases { kind:
// "runtime_bytes" | "model_bytes", done, total }, and on the tuning step:
// `candidate` (the 1-based index a report is about — `done + 1` when it
// starts, `done` when it closes), `budget_seconds` (the tune's own clock; a
// sixteenth of it per planned candidate sizes the plan-scaled estimate until a
// candidate has finished) and `cut` (the budget stopped the tune short of its
// plan). The first run's own waits arrive as steps of their own (`starting`,
// `checking`, `working`).
//
// Nothing here is written while rendering: a step's view, its pace and its
// frozen clock are state the view adjusts through React's render-time
// pattern, so a render that never commits leaves no trace.

import type { English } from "../i18n/en/all";
import { downloadBytes } from "../lib/downloadBytes";
import type { TuneFace, TuneWait } from "./tuneProgress";
import { growthOf } from "./walkFigures";

export interface ProgressStep {
  kind?: string;
  done?: number;
  total?: number;
  candidate?: number;
  budget_seconds?: number;
  cut?: boolean;
  retry_next?: boolean;
  kept_winner?: boolean;
}

// One plain line per phase, as a key into the setup table. A `kind` nobody
// sent degrades to the neutral line — fail closed, never a blank screen.
const HEAD: Record<
  string,
  "checkingComputer" | "gettingReady" | "downloading" | "tuning" | "starting"
> = {
  starting: "starting",
  checking: "checkingComputer",
  working: "gettingReady",
  measuring: "checkingComputer",
  deciding: "gettingReady",
  runtime_bytes: "downloading",
  choosing: "gettingReady",
  tuning: "tuning",
  model_bytes: "downloading",
};

// One rounding, one source: the percentage is computed from the same
// displayed numbers the line shows, so the line cannot disagree with itself —
// and it stays below 100 until every byte has arrived, which a rounded
// "4.6 of 4.6 GB" alone would claim early.
// The numbers are formatted for the chosen language, so the ratio is kept as
// numbers and only the display strings are words.
function display(done: number, total: number, tag: string): { parts: [string, string, string]; pct: number | null } | null {
  if (done > total) return null;
  const oneDecimal = new Intl.NumberFormat(tag, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const plain = new Intl.NumberFormat(tag, { maximumFractionDigits: 0 });
  // A total that rounds away to zero in its own unit is no total: there
  // is no percentage of nothing. The ratio uses the same rounded values
  // the line shows, computed before they become words.
  if (total >= 1e9) {
    const shownDone = Math.round(done / 1e8) / 10;
    const shownTotal = Math.round(total / 1e8) / 10;
    if (shownTotal > 0) {
      return { parts: [oneDecimal.format(shownDone), oneDecimal.format(shownTotal), "GB"], pct: done >= total ? 100 : Math.min(99, Math.floor((shownDone / shownTotal) * 100)) };
    }
  } else {
    const shownDone = Math.round(done / 1e6);
    const shownTotal = Math.round(total / 1e6);
    if (shownTotal > 0) {
      return { parts: [plain.format(shownDone), plain.format(shownTotal), "MB"], pct: done >= total ? 100 : Math.min(99, Math.floor((shownDone / shownTotal) * 100)) };
    }
  }
  return null;
}

// The step as the walk shows it: its line, and the honest byte line.
// A null progress hides the line; a null pct hides the bar.
interface WalkView {
  head: string;
  progress: string | null;
  pct: number | null;
  /** The bytes behind a determinate download line, for its pace. */
  bytes: { done: number; total: number } | null;
}

// Pure: the previous phase's name in, this phase's view and name out. The
// "picking up where it stopped" line is said once per phase, which is why
// the previous name travels with the state below rather than a ref.
function walkView(
  raw: ProgressStep,
  previousKind: string | null,
  t: English["setup"],
  tag: string,
): { view: WalkView; kind: string } {
  // A step that is not an object degrades to the neutral line.
  const step: ProgressStep = raw && typeof raw === "object" ? raw : { kind: "unknown" };
  const kind = step.kind ?? "unknown";
  const bytesPhase = kind === "runtime_bytes" || kind === "model_bytes";
  // The walk resumes where it stopped: a phase whose first event already
  // carries bytes is a continuation, and the line says so once.
  const phaseStart = kind !== previousKind;
  const resumed = phaseStart && bytesPhase && (step.done ?? 0) > 0;
  const head = t[HEAD[kind] ?? "gettingReady"];

  if (!bytesPhase) return { view: { head, progress: null, pct: null, bytes: null }, kind };

  const count = (value: number | undefined, min: number): number | null =>
    typeof value === "number" && Number.isFinite(value) && value >= min ? value : null;
  const done = count(step.done, 0) ?? 0;
  const total = count(step.total, 1); // a total of zero is no total

  // No size announced, or a resumed download past the total it was given:
  // how much has arrived is all there honestly is.
  if (total === null || done > total) {
    return { view: { head, progress: done > 0 ? t.receivedSoFar(downloadBytes(done, tag)) : t.receiving, pct: null, bytes: null }, kind };
  }
  const shown = display(done, total, tag);
  if (shown === null) {
    // A total that rounds away to zero in its own unit: there is no
    // percentage of nothing, and the honest line says why.
    return { view: { head, progress: done > 0 ? t.receivedSoFar(downloadBytes(done, tag)) : t.sizeNotAnnounced, pct: null, bytes: null }, kind };
  }
  const text = t.ofTotal(shown.parts[0], shown.parts[1], shown.parts[2]);
  return {
    view: { head, progress: resumed ? t.pickingUp(text) : text, pct: shown.pct ?? 0, bytes: { done, total } },
    kind,
  };
}

/** The wait's sentence in the page's language: one word per answer the
    pure layer gives (the stop's three, the plan-scaled estimate, the rate,
    and the overrun). */
export function waitWord(wait: TuneWait, t: English["setup"]): string {
  switch (wait.kind) {
    case "cut":
      return t.finishNextStart;
    case "kept":
      return t.keptBest;
    case "standard":
      return t.standardSettings;
    case "almost":
      return t.almostDone;
    // The plan-scaled estimate and the averaged one read the same to the owner.
    case "planned":
    case "minutes":
      return t.minutesLeft(wait.minutes);
  }
}

/** What one step commits to: its view (computed once, so the resumed line
    does not flicker between ticks) and its pace — which candidate is under
    the clock, which finished ones the average runs on, a cut's frozen
    time — plus the figure the wait last showed. */
export interface Walk {
  step: ProgressStep;
  table: English["setup"];
  tag: string;
  key: string;
  /** The phase before this step, kept from when the step arrived: a
      language change re-renders the same step and must not lose the
      resumed line by reading the phase as its own predecessor. */
  before: string | null;
  kind: string;
  view: WalkView;
  candidate: number;
  timed: boolean;
  durations: number[];
  frozen: number | null;
  waitMinutes: number | null;
  /** What had arrived when this byte phase began: its pace counts from here. */
  from: number;
  /** Where the tree stands. It only grows: a later phase with no fraction
      must not shrink what the download grew. */
  growth: number;
}

/** The clock one step runs on: its candidate inside the tune, its phase
    outside it. */
export function clockKey(step: ProgressStep, face: TuneFace | null): string {
  return face !== null ? `tuning:${face.candidate}` : `phase:${step.kind ?? "unknown"}`;
}

export function begin(step: ProgressStep, face: TuneFace | null, seconds: number, t: English["setup"], tag: string): Walk {
  const { view, kind } = walkView(step, null, t, tag);
  return {
    step,
    table: t,
    tag,
    key: clockKey(step, face),
    before: null,
    kind,
    view,
    candidate: face !== null ? face.candidate : 0,
    timed: face !== null && !face.closing,
    durations: [],
    frozen: face !== null && face.cut ? seconds : null,
    waitMinutes: null,
    from: step.done ?? 0,
    growth: growthOf(kind, view.pct, false),
  };
}

export function advance(previous: Walk, step: ProgressStep, face: TuneFace | null, seconds: number, t: English["setup"], tag: string): Walk {
  // The pace moves only when a STEP moves: a language change re-derives
  // the same step's words (t and tag are inputs to the view too) and must
  // not count the same candidate twice.
  const stepChanged = previous.step !== step;
  const before = stepChanged ? previous.kind : previous.before;
  const { view, kind } = walkView(step, before, t, tag);
  const key = clockKey(step, face);
  const changed = key !== previous.key;
  const durations = [...previous.durations];
  let candidate = previous.candidate;
  let timed = previous.timed;
  let frozen = previous.frozen;
  // A plan with nothing measured yet is a new one — a retry counts from
  // zero again — and the figure the last plan held to must not speak for
  // it.
  const waitMinutes = face !== null && face.done === 0 ? null : previous.waitMinutes;
  const from = kind !== previous.kind ? (step.done ?? 0) : previous.from;
  if (stepChanged && face !== null) {
    if (changed) {
      // A candidate began under this clock — or the view joined one that
      // was already running, which arrives as a close and never counts:
      // half a candidate would drag the estimate down.
      candidate = face.candidate;
      timed = !face.closing;
    } else if (face.closing && timed) {
      // This candidate closed under its own clock: what it cost is the
      // next sample of the average the bar and the wait run on.
      durations.push(seconds);
      timed = false;
    }
    if (face.cut && frozen === null) {
      // A cut stops the line's clock where it stood — and the clock that
      // stops is THIS phase's: a stop that arrives on a fresh key (no
      // candidate ran) starts at zero instead of freezing the previous
      // phase's seconds into a tune that never used them.
      frozen = changed ? 0 : seconds;
    }
  }
  return {
    step,
    table: t,
    tag,
    key,
    before,
    kind,
    view,
    candidate,
    timed,
    durations,
    frozen,
    waitMinutes,
    from,
    growth: previous.growth,
  };
}

