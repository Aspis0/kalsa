import { useRef } from "react";
import type { English } from "../i18n/en/all";
import { useLanguage } from "../i18n/useLanguage";
import { Sprout } from "../components/Sprout";
import { useElapsed } from "./useElapsed";
import { minutesLeft, tuneFace, tunePercent, tuneShare } from "./tuneProgress";

// The first run, rendered: the walk's progress, live — a port of the former
// vanilla setup page, removed when the chat became the frontend. The backend
// contract is the Progress event
// `brain_progress`, serialised in src-tauri/src/startup.rs with the tag
// "kind": { kind: "measuring" | "deciding" | "choosing" | "tuning" }, the byte
// phases { kind: "runtime_bytes" | "model_bytes", done, total }, and the
// tune's own third number on the tuning step: `candidate`, the 1-based index
// of the candidate a report is about — `done + 1` when it starts, `done` when
// it closes. This view replaces the Server surface body while the walk runs;
// the walk's failures arrive as brain_start rejections and are spoken by the
// Server surface. The words are this page's.
//
// The first run's own waits — the check, the engine coming up, the choice —
// arrive as steps of their own (`starting`, `checking`, `working`), so every
// long wait on screen renders through this one view: a line, a plant that is
// never still, a bar (the phase's own fraction where it has one, walking
// stripes where it does not) and the time it has been there.

export interface ProgressStep {
  kind?: string;
  done?: number;
  total?: number;
  candidate?: number;
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

function walkView(raw: ProgressStep, lastKind: { current: string | null }, t: English["setup"], tag: string): WalkView {
  // A step that is not an object degrades to the neutral line.
  const step: ProgressStep = raw && typeof raw === "object" ? raw : { kind: "unknown" };
  const kind = step.kind ?? "unknown";
  const bytesPhase = kind === "runtime_bytes" || kind === "model_bytes";
  // The walk resumes where it stopped: a phase whose first event already
  // carries bytes is a continuation, and the line says so once.
  const phaseStart = kind !== lastKind.current;
  lastKind.current = kind;
  const resumed = phaseStart && bytesPhase && (step.done ?? 0) > 0;
  const head = t[HEAD[kind] ?? "gettingReady"];

  if (!bytesPhase) return { head, progress: null, pct: null };

  const count = (value: number | undefined, min: number): number | null =>
    typeof value === "number" && Number.isFinite(value) && value >= min ? value : null;
  const done = count(step.done, 0) ?? 0;
  const total = count(step.total, 1); // a total of zero is no total

  // No size announced, or a resumed download past the total it was given:
  // how much has arrived is all there honestly is.
  if (total === null || done > total) {
    return { head, progress: done > 0 ? t.receivedSoFar(receivedText(done, tag)) : t.receiving, pct: null };
  }
  const shown = display(done, total, tag);
  if (shown === null) {
    // A total that rounds away to zero in its own unit: there is no
    // percentage of nothing, and the honest line says why.
    return { head, progress: done > 0 ? t.receivedSoFar(receivedText(done, tag)) : t.sizeNotAnnounced, pct: null };
  }
  const text = t.ofTotal(shown.parts[0], shown.parts[1], shown.parts[2]);
  return {
    head,
    progress: resumed ? t.pickingUp(text) : text,
    pct: shown.pct ?? 0,
  };
}

/** The elapsed time in the page's own shape: minutes, then the seconds with
    their zero — `0:07`, `1:42`. */
function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** The walk's own view: one step on screen, honest about bytes and time. */
export function SetupProgress({ step }: { step: ProgressStep }) {
  const { table, tag } = useLanguage();
  const t = table.setup;
  const face = tuneFace(step);
  // One clock per candidate inside the tune, one per phase outside it: the
  // line's time and the bar's share are read off it, and the interval
  // behind it is cleared the moment this view unmounts.
  const key = face !== null ? `tuning:${face.candidate}` : `phase:${step.kind ?? "unknown"}`;
  const seconds = useElapsed(key);
  // The clock restarts with the key, but only AFTER this render — so the
  // render that changes it still carries the previous candidate's seconds,
  // and this ref is what says zero until the tick catches up.
  const tick = useRef(key);
  const justChanged = tick.current !== key;
  tick.current = key;
  const lastKind = useRef<string | null>(null);
  const pace = useRef({ key: "", candidate: 0, timed: false, durations: [] as number[] });
  const cache = useRef<{ step: ProgressStep; view: WalkView } | null>(null);
  // React re-renders more often than steps arrive, so each step object is
  // derived exactly once, by identity — and the pace below is settled with
  // it, never on a tick: one candidate's cost is measured once, when the
  // step that closes it arrives.
  if (cache.current === null || cache.current.step !== step) {
    const view = walkView(step, lastKind, t, tag);
    const changed = pace.current.key !== key;
    if (changed) {
      if (face !== null) {
        // A candidate began under this clock — or the view joined one that
        // was already running, which arrives as a close and never counts:
        // half a candidate would drag the estimate down.
        pace.current.candidate = face.candidate;
        pace.current.timed = !face.closing;
      }
      pace.current.key = key;
    } else if (face !== null && face.closing && pace.current.timed) {
      // This candidate closed under its own clock: what it cost is the next
      // sample of the average the bar and the estimate run on.
      pace.current.durations.push(seconds);
      pace.current.timed = false;
    }
    cache.current = { step, view };
  }
  const { view } = cache.current;
  const elapsed = justChanged ? 0 : seconds;
  const durations = pace.current.durations;
  const average = durations.length > 0 ? durations.reduce((sum, value) => sum + value, 0) / durations.length : 0;
  const share = face !== null ? tuneShare(face, elapsed, average) : 0;
  const pct = face !== null ? (face.total > 0 ? tunePercent(face, share) : null) : view.pct;
  const done = face !== null && face.total > 0 && face.done >= face.total;
  const estimate = face !== null ? minutesLeft(face, share, average) : null;

  // The line under the bar: the tune names its test, that test's time and —
  // once one candidate finished — what is left of the wait; the byte phases
  // say what has arrived; every other phase is the time alone.
  const line =
    face !== null
      ? face.total > 0
        ? [
            t.attempt(face.candidate, face.total),
            clock(elapsed),
            ...(estimate !== null ? [t.minutesLeft(estimate)] : []),
          ].join(" · ")
        : clock(elapsed)
      : (view.progress ?? clock(elapsed));

  return (
    <div className="surface-walk">
      <p className="surface-verdict">{view.head}</p>
      <Sprout pct={pct} done={done} caption={line} />
    </div>
  );
}
