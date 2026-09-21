/**
 * The pure motion model of the thought cloud: the trail's geometry, the cloud's
 * breath envelope, the touch-target floor, and the conditions each gesture runs
 * under.
 *
 * Only a type is imported, on purpose. Every function marked "worklet" is called
 * on the UI thread from ThoughtCloud.tsx, and that file must not compute any of
 * these numbers itself: this module is the one place they are written down, and
 * the one place a test can reach them without a render harness.
 *
 * The numbers are the desktop's, from kalsa-brain/chat/src/components/
 * ThoughtCloud.css (`bubble-rise`, `bubble-settle`, `thought-breathe`); each
 * comment names the rule it comes from, and the one place the port deliberately
 * departs from the reference is called out where it happens.
 */
import type { ThinkingPhase } from "./thinkingTiming";

/**
 * One 14px segment, shared by both gestures: the rise travels 0 -> -14px, the
 * settle -14 -> 0.
 *
 * The anchor is deliberately NOT the desktop's. The reference rise sweeps
 * +12px -> -2px, and its settle ends at translateY(12px) with `backwards` fill
 * only, so the span snaps 12px to the origin on the settle's last frame. Moving
 * the anchor to the rest pose deletes that snap and leaves one downward gesture
 * that ends where the bubble lives. Do not "restore fidelity" here: the
 * reference's numbers bring the snap back.
 */
export const TRAIL_TRAVEL_PX = 14;

/**
 * `bubble-rise`: opacity 0 -> 1 -> 0 over the turn (the fade-in is the first
 * quarter of it), scale 0.7 -> 0.45.
 */
export const RISE = { fadeTurn: 0.25, scaleFrom: 0.7, scaleTo: 0.45 } as const;

/** `bubble-settle`: opacity reaches 1 at 35% of the gesture, scale 0.5 -> 1. */
export const SETTLE = { fadeTurn: 0.35, scaleFrom: 0.5 } as const;

/** `calc(var(--bubble-period) / -3)` and `/ -1.5`: a third of a turn apart. */
export const RISE_STAGGER_TURNS = [0, 1 / 3, 2 / 3] as const;

/** `thought-breathe 2.6s`: two 1300 ms halves, and `scale(1.012)` at the peak. */
const BREATHE_HALF_MS = 1300;
export const CLOUD_BREATHE = { cycleMs: 2 * BREATHE_HALF_MS, peak: 1.012 } as const;

/**
 * The head row's own height, not a hitSlop. The row used to be as tall as its
 * type (~34dp), which is a mis-tap on a 3-inch screen; a real 48dp row is the
 * honest fix. The desktop can afford a 19px row because a mouse does not.
 */
export const MIN_TOUCH_TARGET_DP = 48;

/** The desktop stylesheet is rem-based; one rem is what the browser used. */
export const REM_DP = 16;

/**
 * The cloud's own box, in dp, exactly as `ThoughtCloud.tsx` draws it. It lives
 * here with the other cloud numbers because the node test stack cannot import
 * that component (DESIGN.md, "proof regime"); the component builds its styles
 * from these same fields, so the sum below cannot drift from the drawing.
 */
export const CLOUD_BOX = {
  /** A 1 dp hairline, top and bottom. */
  border: 1,
  /** `padding-top: 0.55rem`, above the head row. */
  paddingTop: 0.55 * REM_DP,
  /** `padding-bottom: 0.65rem`, below it. */
  paddingBottom: 0.65 * REM_DP,
  /** The trail under the head row: `margin-top: 6`, three bubbles with a 4 dp
   *  gap between each pair, and `margin-bottom: -9` pulled back up again. */
  trailMarginTop: 6,
  trailGap: 4,
  trailMarginBottom: -9,
} as const;

/** Widest to narrowest, with the inset that offsets it in the trail. */
export const CLOUD_TRAIL_BUBBLES = [
  { size: 9, inset: 0 },
  { size: 7, inset: 2 },
  { size: 5, inset: 5 },
] as const;

/** The trail's net vertical cost: margin, bubbles, gaps, negative margin. */
export const CLOUD_TRAIL_HEIGHT_DP =
  CLOUD_BOX.trailMarginTop +
  CLOUD_TRAIL_BUBBLES.reduce((total, bubble) => total + bubble.size, 0) +
  CLOUD_BOX.trailGap * (CLOUD_TRAIL_BUBBLES.length - 1) +
  CLOUD_BOX.trailMarginBottom;

/**
 * What the cloud occupies with the disclosure shut: its two borders, its two
 * paddings, the 48 dp head row and the trail. It is the component's own height
 * and NOT a clearance the transcript owes it: `transcriptLayout.ts` used to size
 * its bottom gap from this number, on the argument that the tallest thing that
 * can be last must fit, and that argument was wrong — the cloud has to be
 * visible and scrollable, not to fit in a gap. See `TRANSCRIPT_LAST_ITEM_GAP`
 * there for why.
 */
export const CLOUD_COLLAPSED_HEIGHT_DP =
  2 * CLOUD_BOX.border +
  CLOUD_BOX.paddingTop +
  MIN_TOUCH_TARGET_DP +
  CLOUD_BOX.paddingBottom +
  CLOUD_TRAIL_HEIGHT_DP;

/** The documented envelope of each gesture. ./thoughtMotion.test.ts samples against it. */
export const POSE_RANGE = {
  rise: { opacity: [0, 1], scale: [RISE.scaleTo, RISE.scaleFrom], translateY: [-TRAIL_TRAVEL_PX, 0] },
  settle: { opacity: [0, 1], scale: [SETTLE.scaleFrom, 1], translateY: [-TRAIL_TRAVEL_PX, 0] },
  rest: { opacity: [1, 1], scale: [1, 1], translateY: [0, 0] },
} as const;

export type TrailPose = {
  /** Offset from the rest pose in px. Never positive. */
  translateY: number;
  scale: number;
  opacity: number;
};

export type PoseInput = {
  phase: ThinkingPhase;
  /** The bubble's place in the trail: 0, 1 or 2. */
  index: number;
  /** Progress of the rise in turns, [0,1). Wraps once per period. */
  riseTurns: number;
  /** Progress of the settle gesture, [0,1], already eased by the caller. */
  settleProgress: number;
  /** Reduce motion is on: the trail holds the rest pose instead of a gesture. */
  reduced: boolean;
};

const clamp01 = (v: number): number => {
  "worklet";
  // Written with `>` so that a NaN (a progress that escaped) lands on 0, the
  // start of a gesture, rather than reaching a transform.
  return v > 0 ? (v < 1 ? v : 1) : 0;
};

/**
 * One frame of the rise. The accumulator counts TURNS, not elapsed time, so a
 * retargeted period changes the slope and never the position: recomputing
 * progress as elapsed / period would jump the whole trail the moment a new
 * token rate arrived. Two guards, both real: the first frame after activation
 * reports `timeSincePreviousFrame: null`, and a zero period (a caller that
 * forgot to seed it) would divide by zero and put NaN into a transform.
 */
export function advancePhase(progress: number, dtMs: number | null | undefined, periodMs: number): number {
  "worklet";
  const dt = dtMs ?? 0;
  if (!(periodMs > 0)) return progress;
  return ((progress + dt / periodMs) % 1 + 1) % 1;
}

/**
 * The trail's pose at one instant. `periodMs` is NOT a parameter: the period
 * shapes time, and by the time a pose is asked for, time has already been spent
 * by advancePhase. Passing it here would only invite the elapsed/period
 * division that the turn accumulator exists to avoid.
 */
export function bubblePose(input: PoseInput): TrailPose {
  "worklet";
  const { index, phase, reduced, riseTurns, settleProgress } = input;
  if (reduced || phase === "rest") return { opacity: 1, scale: 1, translateY: 0 };
  if (phase === "rise") {
    const stagger = RISE_STAGGER_TURNS[index] ?? 0;
    // `+ 1` before `%`: a negative accumulator must wrap forward, not negative.
    const p = ((riseTurns + stagger) % 1 + 1) % 1;
    return {
      opacity: p <= RISE.fadeTurn ? p / RISE.fadeTurn : (1 - p) / (1 - RISE.fadeTurn),
      scale: RISE.scaleFrom + (RISE.scaleTo - RISE.scaleFrom) * p,
      // `0 -` rather than a unary minus: at p = 0 this must be a plain 0, not the
      // -0 a multiplication hands out, so that the start of a turn and the rest
      // pose compare equal.
      translateY: 0 - TRAIL_TRAVEL_PX * p,
    };
  }
  const e = clamp01(settleProgress);
  return {
    opacity: Math.min(1, e / SETTLE.fadeTurn),
    scale: SETTLE.scaleFrom + (1 - SETTLE.scaleFrom) * e,
    translateY: TRAIL_TRAVEL_PX * (e - 1),
  };
}

/** One axis of a cubic bezier whose endpoints are pinned at 0 and 1. */
function bezierAxis(p1: number, p2: number, u: number): number {
  "worklet";
  const v = 1 - u;
  return 3 * v * v * u * p1 + 3 * v * u * u * p2 + u * u * u;
}

/**
 * A CSS timing function, evaluated the way a browser evaluates one: solve
 * x(u) = t, then return y(u). Bisection rather than Newton — CSS requires a
 * monotone x, and bisection cannot diverge on a flat segment.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number, t: number): number {
  "worklet";
  // Both endpoints and a NaN are answered exactly, not by the solver: bisection
  // on [0,1] converges to the ends but never arrives, and a NaN compares false
  // against everything, so it must be caught before the loop.
  if (!(t > 0)) return 0;
  if (t >= 1) return 1;
  let low = 0;
  let high = 1;
  let u = t;
  for (let i = 0; i < 30; i++) {
    u = (low + high) / 2;
    if (bezierAxis(x1, x2, u) < t) low = u;
    else high = u;
  }
  return bezierAxis(y1, y2, u);
}

/**
 * CSS `ease-in-out`, which is cubic-bezier(0.42, 0, 0.58, 1). Spelled out
 * rather than taken from the animation library: Reanimated's `Easing.ease` is
 * cubic-bezier(0.42, 0, 1, 1) — `ease`, not `ease-in-out` — and `Easing.inOut`
 * of it is a third curve again.
 */
export function cssEaseInOut(t: number): number {
  "worklet";
  return cubicBezier(0.42, 0, 0.58, 1, t);
}

/**
 * The cloud's breath over one cycle: 0 -> peak -> 0, with the CSS ease-in-out
 * applied to each half, which is what `animation-timing-function` does per
 * keyframe segment. The component drives this from a LINEAR ramp, so the whole
 * envelope is a pure function of the cycle and cannot drift from the tests.
 */
export function cloudBreathScale(cycle: number): number {
  "worklet";
  const c = clamp01(cycle);
  const half = c < 0.5 ? c / 0.5 : (1 - c) / 0.5;
  return 1 + (CLOUD_BREATHE.peak - 1) * cssEaseInOut(half);
}

/** The rise's frame callback runs while the gesture is live, unless motion is off. */
export function riseFramesActive(phase: ThinkingPhase, reduced: boolean): boolean {
  return !reduced && phase === "rise";
}

/** The cloud breathes while the model is working, unless motion is off. */
export function breatheActive(working: boolean, reduced: boolean): boolean {
  return working && !reduced;
}
