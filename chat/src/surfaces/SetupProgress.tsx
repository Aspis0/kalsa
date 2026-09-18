import { useRef } from "react";
import type { CSSProperties } from "react";

// The first run, rendered: the walk's progress, live — a port of the former
// vanilla setup page, removed when the chat became the frontend. The backend
// contract is the Progress event
// `brain_progress`, serialised in src-tauri/src/startup.rs with the tag
// "kind": { kind: "measuring" | "deciding" | "choosing" } and the byte
// phases { kind: "runtime_bytes" | "model_bytes", done, total }. This view
// replaces the Server surface body while the walk runs; the walk's failures
// arrive as brain_start rejections and are spoken by the Server surface. The words
// are this page's.

export interface ProgressStep {
  kind?: string;
  done?: number;
  total?: number;
}

interface WalkCopy {
  head: string;
  sentence: string;
}

const GENERIC_SENTENCE = "Getting this computer ready. This happens once.";

// Why the computer is doing this, per phase. A `kind` nobody sent degrades
// to the neutral sentence — fail closed, never a blank screen.
const COPY: Record<string, WalkCopy> = {
  measuring: {
    head: "Getting ready",
    sentence:
      "Looking at what this computer has to work with — how much memory it has, and what is inside it.",
  },
  deciding: {
    head: "Getting ready",
    sentence: "Finding the version of the engine that fits this computer.",
  },
  runtime_bytes: {
    head: "Downloading",
    sentence:
      "Your computer needs its own copy of the engine that does the thinking. This happens once.",
  },
  choosing: {
    head: "Getting ready",
    sentence:
      "Deciding which model fits this computer and knows more than the one on your phone.",
  },
  model_bytes: {
    head: "Downloading",
    sentence:
      "Now the model itself — the part that knows things. It is the bigger download, and it also happens only once.",
  },
  unknown: {
    head: "Getting ready",
    sentence: GENERIC_SENTENCE,
  },
};

// One rounding, one source: the percentage is computed from the same
// displayed numbers the line shows, so the line cannot disagree with itself.
// With no usable total there is no percentage and no bar — how much has
// arrived is all there honestly is.
function display(done: number, total: number): { text: string; pct: number | null } {
  if (done <= total) {
    const shown =
      total >= 1e9
        ? [(done / 1e9).toFixed(1), (total / 1e9).toFixed(1), "GB"]
        : [String(Math.round(done / 1e6)), String(Math.round(total / 1e6)), "MB"];
    // A total that rounds away to zero in its own unit is no total: there
    // is no percentage of nothing.
    const totalShown = Number(shown[1]);
    if (totalShown > 0) {
      const pct = Math.floor((Number(shown[0]) / totalShown) * 100);
      return { text: `${shown[0]} of ${shown[1]} ${shown[2]} · ${pct}%`, pct };
    }
  }
  if (done <= 0) return { text: "Receiving — the size was not announced.", pct: null };
  const received = done >= 1e9 ? `${(done / 1e9).toFixed(1)} GB` : `${Math.round(done / 1e6)} MB`;
  return { text: `${received} received so far.`, pct: null };
}

// The step as the walk shows it: head, sentence, and the honest byte line.
// A null progress hides the line; a null pct hides the bar.
interface WalkView {
  head: string;
  sentence: string;
  progress: string | null;
  pct: number | null;
}

function walkView(raw: ProgressStep, lastKind: { current: string | null }): WalkView {
  // A step that is not an object degrades to the neutral sentence — fail
  // closed, never a blank screen.
  const step: ProgressStep = raw && typeof raw === "object" ? raw : { kind: "unknown" };
  const kind = step.kind ?? "unknown";
  const bytesPhase = kind === "runtime_bytes" || kind === "model_bytes";
  // The walk resumes where it stopped: a phase whose first event already
  // carries bytes is a continuation, and the line says so once.
  const phaseStart = kind !== lastKind.current;
  lastKind.current = kind;
  const resumed = phaseStart && bytesPhase && (step.done ?? 0) > 0;

  const copy = COPY[kind] ?? COPY.unknown;

  if (!bytesPhase) {
    return { head: copy.head, sentence: copy.sentence, progress: null, pct: null };
  }

  const count = (value: number | undefined, min: number): number | null =>
    typeof value === "number" && Number.isFinite(value) && value >= min ? value : null;
  const done = count(step.done, 0) ?? 0;
  const total = count(step.total, 1); // a total of zero is no total

  if (total === null || done > total) {
    // No size announced, or a resumed download past the total it was
    // given: how much has arrived is all there honestly is.
    const received = done >= 1e9 ? `${(done / 1e9).toFixed(1)} GB` : `${Math.round(done / 1e6)} MB`;
    return {
      head: copy.head,
      sentence: copy.sentence,
      progress: done > 0 ? `${received} received so far.` : "Receiving.",
      pct: null,
    };
  }
  const shown = display(done, total);
  return {
    head: copy.head,
    sentence: copy.sentence,
    progress: resumed ? `Picking up where it stopped — ${shown.text}` : shown.text,
    pct: shown.pct ?? 0,
  };
}

/** The walk's own view: one step on screen, honest about bytes and time. */
export function SetupProgress({ step }: { step: ProgressStep }) {
  // The walk remembers which phase it is in across steps, so the resumed
  // line is said once per phase. React re-renders more often than steps
  // arrive, so each step object is derived exactly once, by identity.
  const lastKind = useRef<string | null>(null);
  const cache = useRef<{ step: ProgressStep; view: WalkView } | null>(null);
  if (cache.current === null || cache.current.step !== step) {
    cache.current = { step, view: walkView(step, lastKind) };
  }
  const view = cache.current.view;

  return (
    <div className="surface-walk">
      <p className="surface-verdict">{view.head}</p>
      <p className="surface-sentence">{view.sentence}</p>
      {view.progress !== null ? <p className="surface-walk-progress">{view.progress}</p> : null}
      {view.pct !== null ? (
        <div className="surface-walk-bar" style={{ "--pct": `${view.pct}%` } as CSSProperties} />
      ) : null}
    </div>
  );
}
