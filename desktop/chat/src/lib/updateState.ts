// The update's state, as the Settings block and the startup notice both read
// it. Pure: the hook in `useUpdates.ts` feeds it actions from the calls and
// the events, and `scripts/updates-state.mjs` checks the transitions.

import type { AvailableUpdate, UpdateErrorPayload, UpdateStatus } from "./update";

export type Phase =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current" }
  | { kind: "available"; version: string; notes: string | null }
  | { kind: "downloading"; version: string; done: number; total: number | null }
  /** `version` is the release an install was for, so the page can offer
      it again; null when the failure came from a check. */
  | { kind: "failed"; error: UpdateErrorPayload; version: string | null };

export interface UpdateState {
  /** The version this build runs; null until the page has asked. */
  current: string | null;
  phase: Phase;
  /** The update the startup check announced, until the owner dismisses it. */
  notice: AvailableUpdate | null;
}

export type UpdateAction =
  | { type: "version"; version: string }
  | { type: "checkStarted" }
  | { type: "checkFinished"; status: UpdateStatus }
  | { type: "failed"; error: UpdateErrorPayload; version?: string }
  | { type: "installStarted"; version: string }
  | { type: "progress"; done: number; total: number | null }
  | { type: "announced"; update: AvailableUpdate }
  | { type: "noticeDismissed" };

export const INITIAL_UPDATE: UpdateState = { current: null, phase: { kind: "idle" }, notice: null };

export function reduceUpdate(state: UpdateState, action: UpdateAction): UpdateState {
  switch (action.type) {
    case "version":
      return { ...state, current: action.version };
    case "checkStarted":
      // A check during a download would overwrite the bar the owner is watching.
      if (state.phase.kind === "downloading") return state;
      return { ...state, phase: { kind: "checking" } };
    case "checkFinished": {
      if (state.phase.kind === "downloading") return state;
      const found = action.status.available;
      if (!found) {
        // Nothing newer now: the notice's release is gone, so its button goes too.
        return { ...state, phase: { kind: "current" }, notice: null };
      }
      // A dismissed notice stays dismissed; one still on screen takes this check's version and notes.
      const notice = state.notice ? { version: found.version, notes: found.notes } : null;
      return { ...state, phase: { kind: "available", version: found.version, notes: found.notes }, notice };
    }
    case "failed":
      return { ...state, phase: { kind: "failed", error: action.error, version: action.version ?? null } };
    case "installStarted":
      return { ...state, phase: { kind: "downloading", version: action.version, done: 0, total: null } };
    case "progress":
      if (state.phase.kind !== "downloading") return state;
      return { ...state, phase: { ...state.phase, done: action.done, total: action.total } };
    case "announced":
      return { ...state, notice: action.update };
    case "noticeDismissed":
      return { ...state, notice: null };
  }
}
