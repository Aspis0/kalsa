import type { BrainState } from "./useBrain";
import type { ProgressStep } from "./walkState";

/** The walk's step the first page shows: only while the brain is stopped or
    starting and no start failure is held. */
export function walkStepShown(
  kind: BrainState["kind"] | null,
  heldFailure: string | null,
  step: ProgressStep | null,
): ProgressStep | null {
  const walking = kind === "stopped" || kind === "starting";
  return walking && heldFailure === null ? step : null;
}

/** The step still held once the brain answers `next`. Reaching running ends the
    walk, so its last step is dropped there and cannot come back on a later
    stop or crash. Staying in running keeps it: the shell's own vision download
    reads the same step while the engine is up. */
export function heldStepAfter(
  previous: BrainState["kind"] | null,
  next: BrainState["kind"] | null,
  step: ProgressStep | null,
): ProgressStep | null {
  return next === "running" && previous !== "running" ? null : step;
}

export type WalkSignal =
  | { kind: "begin" }
  | { kind: "end" }
  | { kind: "state"; previous: BrainState["kind"] | null; next: BrainState["kind"] | null };

/** Whether a `brain_progress` event is taken: while a walk is armed, or before
    the brain's state is first read. Nothing is known to have ended a walk until
    the page has seen the state, so a walk already running at launch keeps its
    first events. */
export function progressTaken(armed: boolean, stateKnown: boolean): boolean {
  return armed || !stateKnown;
}

/** Whether a walk is armed. A walk is armed by the owner
    starting it (Turn on, a model chosen, the vision download, which runs while
    the engine is up) or by the brain entering starting, and disarmed by Turn
    off or by the brain leaving starting or running. A late event then cannot
    write a step back after its walk has ended. */
export function walkArmedAfter(armed: boolean, signal: WalkSignal): boolean {
  switch (signal.kind) {
    case "begin":
      return true;
    case "end":
      return false;
    case "state": {
      if (signal.next === "starting" && signal.previous !== "starting") return true;
      const leftWalk =
        (signal.previous === "starting" || signal.previous === "running") && signal.previous !== signal.next;
      return leftWalk ? false : armed;
    }
  }
}
