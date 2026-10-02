import { Fragment, useEffect, useState } from "react";
import type { English } from "../i18n/en/all";
import { useLanguage } from "../i18n/useLanguage";
import { Sprout } from "../components/Sprout";
import { useElapsed } from "./useElapsed";
import { tuneDone, tuneFace, tunePercent, tuneShare, tuneWait } from "./tuneProgress";
import type { TuneFace } from "./tuneProgress";

// The first run, rendered: the walk's progress, live — a port of the former
// vanilla setup page, removed when the chat became the frontend. The backend
// contract is the Progress event
// `brain_progress`, serialised in src-tauri/src/startup.rs with the tag
// "kind": { kind: "measuring" | "deciding" | "choosing" | "tuning" }, the byte
// phases { kind: "runtime_bytes" | "model_bytes", done, total }, and on the
// tuning step: `candidate` (the 1-based index a report is about — `done + 1`
// when it starts, `done` when it closes) and `cut` (the budget stopped the
// tune short of its plan: the bar holds where it reached, the line says the
// next start finishes, and no finish is played for a tune that owes work).
// This view replaces the Server surface body while the walk runs; the walk's
// failures arrive as brain_start rejections and are spoken by the Server
// surface. The words are this page's.
//
// The first run's own waits — the check, the engine coming up, the choice —
// arrive as steps of their own (`starting`, `checking`, `working`), so every
// long wait on screen renders through this one view: a line, a plant that is
// never still, a bar (the phase's own fraction where it has one, walking
// stripes where it does not) and the time it has been there.
//
// Nothing is written to a ref while rendering: everything a step derives
// (its view, its pace, its frozen clock) is state, adjusted through React's
// render-time pattern below, so a render that never commits leaves no trace.

export interface ProgressStep {
  kind?: string;
  done?: number;
  total?: number;
  candidate?: number;
  cut?: boolean;
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

// The bytes that have arrived, in the one unit worth showing. The unit is
// kept as-is; only the number follows the language.
function receivedText(done: number, tag: string): string {
  const oneDecimal = new Intl.NumberFormat(tag, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return done >= 1e9 ? `${oneDecimal.format(done / 1e9)} GB` : `${new Intl.NumberFormat(tag).format(Math.round(done / 1e6))} MB`;
}

// One rounding, one source: the percentage is computed from the same
// displayed numbers the line shows, so the line cannot disagree with itself.
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
      return { parts: [oneDecimal.format(shownDone), oneDecimal.format(shownTotal), "GB"], pct: Math.floor((shownDone / shownTotal) * 100) };
    }
  } else {
    const shownDone = Math.round(done / 1e6);
    const shownTotal = Math.round(total / 1e6);
    if (shownTotal > 0) {
      return { parts: [plain.format(shownDone), plain.format(shownTotal), "MB"], pct: Math.floor((shownDone / shownTotal) * 100) };
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

  if (!bytesPhase) return { view: { head, progress: null, pct: null }, kind };

  const count = (value: number | undefined, min: number): number | null =>
    typeof value === "number" && Number.isFinite(value) && value >= min ? value : null;
  const done = count(step.done, 0) ?? 0;
  const total = count(step.total, 1); // a total of zero is no total

  // No size announced, or a resumed download past the total it was given:
  // how much has arrived is all there honestly is.
  if (total === null || done > total) {
    return { view: { head, progress: done > 0 ? t.receivedSoFar(receivedText(done, tag)) : t.receiving, pct: null }, kind };
  }
  const shown = display(done, total, tag);
  if (shown === null) {
    // A total that rounds away to zero in its own unit: there is no
    // percentage of nothing, and the honest line says why.
    return { view: { head, progress: done > 0 ? t.receivedSoFar(receivedText(done, tag)) : t.sizeNotAnnounced, pct: null }, kind };
  }
  const text = t.ofTotal(shown.parts[0], shown.parts[1], shown.parts[2]);
  return {
    view: { head, progress: resumed ? t.pickingUp(text) : text, pct: shown.pct ?? 0 },
    kind,
  };
}

/** The elapsed time in the page's own shape: minutes, then the seconds with
    their zero — `0:07`, `1:42`. */
function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** What one step commits to: its view (computed once, so the resumed line
    does not flicker between ticks) and its pace — which candidate is under
    the clock, which finished ones the average runs on, and a cut's frozen
    time. */
interface Walk {
  step: ProgressStep;
  key: string;
  kind: string;
  view: WalkView;
  candidate: number;
  timed: boolean;
  durations: number[];
  frozen: number | null;
}

/** The clock one step runs on: its candidate inside the tune, its phase
    outside it. */
function clockKey(step: ProgressStep, face: TuneFace | null): string {
  return face !== null ? `tuning:${face.candidate}` : `phase:${step.kind ?? "unknown"}`;
}

function begin(step: ProgressStep, face: TuneFace | null, seconds: number, t: English["setup"], tag: string): Walk {
  const { view, kind } = walkView(step, null, t, tag);
  return {
    step,
    key: clockKey(step, face),
    kind,
    view,
    candidate: face !== null ? face.candidate : 0,
    timed: face !== null && !face.closing,
    durations: [],
    frozen: face !== null && face.cut ? seconds : null,
  };
}

function advance(previous: Walk, step: ProgressStep, face: TuneFace | null, seconds: number, t: English["setup"], tag: string): Walk {
  const { view, kind } = walkView(step, previous.kind, t, tag);
  const key = clockKey(step, face);
  const changed = key !== previous.key;
  const durations = [...previous.durations];
  let candidate = previous.candidate;
  let timed = previous.timed;
  if (face !== null) {
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
  }
  return {
    step,
    key,
    kind,
    view,
    candidate,
    timed,
    durations,
    // A cut stops the line's clock where it stood: the tune is not
    // running anymore, so its time must not keep growing.
    frozen: previous.frozen ?? (face !== null && face.cut ? seconds : null),
  };
}

/** The walk's own view: one step on screen, honest about bytes and time. */
export function SetupProgress({ step }: { step: ProgressStep }) {
  const { table, tag } = useLanguage();
  const t = table.setup;
  const face = tuneFace(step);
  const key = clockKey(step, face);
  const seconds = useElapsed(key);
  // The clock restarts with the key, but only after this render commits —
  // so the render that changes the key still carries the previous phase's
  // seconds, and this one says zero until the tick catches up.
  const [clocked, setClocked] = useState(key);
  useEffect(() => setClocked(key), [key]);
  const restarted = clocked !== key;

  const [walk, setWalk] = useState<Walk>(() => begin(step, face, 0, t, tag));
  let current = walk;
  if (current.step !== step) {
    // React's render-time adjustment: the derived state is recomputed from
    // the previous step before this render commits, and thrown away with
    // the render if it never does — a ref written here would keep the half
    // of a step that failed.
    current = advance(walk, step, face, seconds, t, tag);
    setWalk(current);
  }

  const elapsed = current.frozen ?? (restarted ? 0 : seconds);
  const durations = current.durations;
  const average = durations.length > 0 ? durations.reduce((sum, value) => sum + value, 0) / durations.length : 0;
  const share = face !== null ? tuneShare(face, elapsed, average) : 0;
  const pct = face !== null ? (face.total > 0 ? tunePercent(face, share) : null) : current.view.pct;
  const done = face !== null && tuneDone(face);
  const wait = face !== null ? tuneWait(face, share, average) : null;
  const waitText =
    wait === null
      ? null
      : wait.kind === "cut"
        ? t.finishNextStart
        : wait.kind === "almost"
          ? t.almostDone
          : t.minutesLeft(wait.minutes);

  // The line under the bar: the tune names its test, that test's time and —
  // once one candidate finished — what is left of the wait (or the stop's
  // own line, or "any moment now"); the byte phases say what has arrived;
  // every other phase is the time alone. The clock ticks every second, so
  // it travels in a span assistive tech skips: the line's live region then
  // speaks when the candidate or the wait changes, not on every tick.
  const segments: Array<{ text: string; hidden: boolean }> = [];
  if (face !== null) {
    if (face.total > 0) segments.push({ text: t.attempt(face.candidate, face.total), hidden: false });
    segments.push({ text: clock(elapsed), hidden: true });
    if (waitText !== null) segments.push({ text: waitText, hidden: false });
  } else if (current.view.progress !== null) {
    segments.push({ text: current.view.progress, hidden: false });
  } else {
    segments.push({ text: clock(elapsed), hidden: true });
  }
  const valueText = segments.map((segment) => segment.text).join(" · ");

  return (
    <div className="surface-walk">
      <p className="surface-verdict">{current.view.head}</p>
      <Sprout
        pct={pct}
        done={done}
        valueText={valueText}
        caption={
          <>
            {segments.map((segment, index) => (
              <Fragment key={index}>
                {index > 0 ? " · " : null}
                <span aria-hidden={segment.hidden}>{segment.text}</span>
              </Fragment>
            ))}
          </>
        }
      />
    </div>
  );
}
