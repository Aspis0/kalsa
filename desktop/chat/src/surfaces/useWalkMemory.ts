import { useEffect, useState } from "react";
import type { ProgressStep } from "./walkState";
import { tuneDone, tuneFace, tunePercent } from "./tuneProgress";
import { growthOf } from "./walkFigures";

export interface WalkMemory {
  /** The last step the walk showed, for the screen it ends on. */
  last: ProgressStep;
  /** How far the walk came, on the walk's one scale (walkFigures.ts). */
  reach: number;
  /** The walk ends on its own screen: it grew the tree, or it is the first
      run's, which owns its ending even when it fails before any download. */
  ownsEnd: boolean;
}

/** The phases that grow the tree: bytes moving or a tune running. A walk
    that saw one keeps the tree and ends on its own screen; a start that only
    measures, decides and chooses stays on Home's turning ring
    (14-home-states-starting). */
const GROWING = new Set(["runtime_bytes", "model_bytes", "tuning"]);

export function drawsTree(step: ProgressStep): boolean {
  return GROWING.has(step.kind ?? "");
}
const WORKING: ProgressStep = { kind: "working" };

/** A step's own reading on the walk's scale. The tune's share inside a running
    candidate is the view's to time; here a candidate counts once it closed. */
function stepGrowth(step: ProgressStep): number {
  const face = tuneFace(step);
  if (face !== null) return growthOf("tuning", face.total > 0 ? tunePercent(face, 0) : null, tuneDone(face));
  const { done, total } = step;
  const pct =
    typeof done === "number" && typeof total === "number" && total > 0 && done <= total
      ? done >= total
        ? 100
        : Math.min(99, Math.floor((done / total) * 100))
      : null;
  return growthOf(step.kind ?? "unknown", pct, false);
}

// Module scope, not component state: the walk's end must outlive the page
// that showed it (Home unmounts whenever another page opens). A memory is
// tagged with the generation it was taken in, so a forget made by any page
// makes it a previous walk's on every page that holds it.
interface HeldWalk {
  memory: WalkMemory;
  generation: number;
}

let held: HeldWalk | null = null;
let generation = 0;

/** The walk the page held is over: a start, a stop, or Start a chat. */
export function forgetWalk(): void {
  held = null;
  generation += 1;
}

/** The walk's last step, kept past its end: the step itself is dropped when
    the brain reaches running or fails, and the first run hands the page to
    Home at that moment, so what the walk ends on is held here. */
export function useWalkMemory(step: ProgressStep | null): { memory: WalkMemory | null; forget: () => void; claim: () => void } {
  const [kept, setKept] = useState<HeldWalk | null>(held);
  const memory = kept?.generation === generation ? kept.memory : null;
  let current = memory;
  if (step !== null && step !== memory?.last) {
    // Render-time adjustment, as SetupProgress does: no ref written in render.
    current = {
      last: step,
      reach: Math.max(memory?.reach ?? 0, stepGrowth(step)),
      ownsEnd: (memory?.ownsEnd ?? false) || GROWING.has(step.kind ?? ""),
    };
    setKept({ memory: current, generation });
  }
  useEffect(() => {
    held = kept;
  }, [kept]);
  return {
    memory: current,
    forget: () => {
      forgetWalk();
      setKept(null);
    },
    claim: () => setKept({ memory: { last: WORKING, reach: 0, ownsEnd: true }, generation }),
  };
}
