// The driver's download, as the page sees it: not installed, installing,
// installed, cancelled, or refused.
//
// `src/lib/driver.ts` is the one place these rules live; the hook and the
// components only feed it actions. The rules that matter: a computer Kalsa has
// no driver for is never offered a press, a download that has already started
// is not started again, a failure keeps its press so it can be tried once more,
// and an event from an attempt nobody is watching changes nothing.
//
// Every attempt is numbered, because a cancel and a retry overlap: the first
// download's last event can still be queued when the second one starts, and a
// bar that jumps to 99% of a download that has just begun is a lie the person
// can see.

export type DriverPhase =
  | { kind: "unsupported" }
  | { kind: "needed" }
  | { kind: "downloading"; done: number; total: number | null }
  | { kind: "ready" }
  | { kind: "failed" }
  | { kind: "cancelled" };

export interface DriverState {
  phase: DriverPhase;
  /** What the archive weighs, kept from the status call so a cancelled download
      can go back to the press with its cost still on it. */
  size: number;
  /** Which attempt the bar belongs to. Only this attempt's events are listened
      to; see the note above. */
  run: number;
}

export const INITIAL_DRIVER: DriverState = { phase: { kind: "needed" }, size: 0, run: 0 };

export type DriverAction =
  | { type: "checked"; supported: boolean; installed: boolean; size: number }
  | { type: "downloadStarted" }
  | { type: "progress"; run: number; done: number; total: number }
  // The download answers with the same status the check did, so both
  // actions carry the same three facts and share one case below.
  | { type: "finished"; supported: boolean; installed: boolean; size: number }
  | { type: "failed" }
  | { type: "cancelled" };

export function reduceDriver(state: DriverState, action: DriverAction): DriverState {
  switch (action.type) {
    case "checked":
    case "finished": {
      if (!action.supported) return { ...state, phase: { kind: "unsupported" } };
      const phase = action.installed ? ({ kind: "ready" } as const) : ({ kind: "needed" } as const);
      return { ...state, phase, size: action.size };
    }
    case "downloadStarted":
      // A second press while one is running would show two bars for one file,
      // and it must not take a number either: the run already counting would
      // lose its own events.
      if (state.phase.kind === "downloading") return state;
      return { ...state, run: state.run + 1, phase: { kind: "downloading", done: 0, total: null } };
    case "progress":
      // Only the run that is counting is listened to. An event from the attempt
      // a cancel stopped, arriving after the retry began, belongs to a bar that
      // no longer exists and would otherwise paint the new one half done.
      if (state.phase.kind !== "downloading" || action.run !== state.run) return state;
      return { ...state, phase: { kind: "downloading", done: action.done, total: action.total } };
    case "failed":
    case "cancelled": {
      // A refusal that arrives after the driver is already there is stale, and a
      // row that is ready or unsupported must not turn into a press.
      if (state.phase.kind === "ready" || state.phase.kind === "unsupported") return state;
      const phase = action.type === "failed" ? ({ kind: "failed" } as const) : ({ kind: "cancelled" } as const);
      return { ...state, phase };
    }
  }
}

/** The whole number a bar shows, or `null` when the total is not known yet. */
export function percentOf(phase: DriverPhase): number | null {
  if (phase.kind !== "downloading") return null;
  if (!phase.total) return null;
  return Math.min(100, Math.floor((phase.done * 100) / phase.total));
}

/** Whether the row offers a press. Only a computer with no driver never does,
    and never a download already running. A cancelled one offers it again: the
    person decided to stop it, so starting over is their next decision. */
export function canPress(phase: DriverPhase): boolean {
  return phase.kind === "needed" || phase.kind === "failed" || phase.kind === "cancelled";
}

/** The size as a person reads it: whole megabytes, never a byte count. */
export function sizeLabel(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}