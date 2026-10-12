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
export function progressTaken(arm: WalkArm, stateKnown: boolean): boolean {
  return arm !== "off" || !stateKnown;
}

/** `owned`: the owner began the walk (Turn on, a model chosen, the vision
    download). `watching`: the brain entered starting without an owner, as a
    crash restart does. Only `owned` ignores the state's leftover reading
    from before it began, which can still say running for a poll after a
    model switch has stopped the engine. */
export type WalkArm = "off" | "owned" | "watching";

/** The owned walk's own ends: the brain reached running or failed, or it
    left starting without starting. A stop that reads running -> stopped is
    not one of them. */
function ownedWalkEnded(previous: BrainState["kind"] | null, next: BrainState["kind"] | null): boolean {
  const reached = (next === "running" || next === "failed") && previous !== next;
  return reached || (previous === "starting" && next !== "starting");
}

/** Whether a walk is armed, and how. Turn off and the walk's end disarm it,
    so a late event cannot write a step back after its walk has ended. */
export function walkArmedAfter(arm: WalkArm, signal: WalkSignal): WalkArm {
  switch (signal.kind) {
    case "begin":
      return "owned";
    case "end":
      return "off";
    case "state": {
      const { previous, next } = signal;
      if (next === "starting" && previous !== "starting") return arm === "off" ? "watching" : arm;
      if (arm === "owned") return ownedWalkEnded(previous, next) ? "off" : "owned";
      const leftWalk = (previous === "starting" || previous === "running") && previous !== next;
      return leftWalk ? "off" : arm;
    }
  }
}
