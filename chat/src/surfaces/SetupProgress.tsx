import { useRef } from "react";
import type { CSSProperties } from "react";
import type { English } from "../i18n/en/all";
import { useLanguage } from "../i18n/useLanguage";

// The first run, rendered: the walk's progress, live — a port of the former
// vanilla setup page, removed when the chat became the frontend. The backend
// contract is the Progress event
// `brain_progress`, serialised in src-tauri/src/startup.rs with the tag
// "kind": { kind: "measuring" | "deciding" | "choosing" | "tuning" } and the byte
// phases { kind: "runtime_bytes" | "model_bytes", done, total }. This view
// replaces the Server surface body while the walk runs; the walk's failures
// arrive as brain_start rejections and are spoken by the Server surface. The words
// are this page's.

export interface ProgressStep {
  kind?: string;
  done?: number;
  total?: number;
}

// One plain line per phase, as a key into the setup table. A `kind` nobody
// sent degrades to the neutral line — fail closed, never a blank screen.
const HEAD: Record<string, "checkingComputer" | "gettingReady" | "downloading" | "tuning"> = {
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

/** The walk's own view: one step on screen, honest about bytes and time. */
export function SetupProgress({ step }: { step: ProgressStep }) {
  const { table, tag } = useLanguage();
  // The walk remembers which phase it is in across steps, so the resumed
  // line is said once per phase. React re-renders more often than steps
  // arrive, so each step object is derived exactly once, by identity.
  const lastKind = useRef<string | null>(null);
  const cache = useRef<{ step: ProgressStep; view: WalkView } | null>(null);
  if (cache.current === null || cache.current.step !== step) {
    cache.current = { step, view: walkView(step, lastKind, table.setup, tag) };
  }
  const view = cache.current.view;

  return (
    <div className="surface-walk">
      <p className="surface-verdict">{view.head}</p>
      {view.progress !== null ? <p className="surface-walk-progress">{view.progress}</p> : null}
      {view.pct !== null ? (
        <div className="surface-walk-bar" style={{ "--pct": `${view.pct}%` } as CSSProperties} />
      ) : null}
    </div>
  );
}
