/**
 * The trail's geometry, the cloud's breath, and the gestures' guard conditions.
 *
 * The component has no render harness in this repo, so everything it draws was
 * pulled into ./thoughtMotion.ts precisely so it can be asserted here: a pose is
 * a function of (phase, progress, index), and progress is a function of (dt,
 * period). These tests are the only thing standing between a refactor and a
 * silently wrong trail.
 */
import {
  CLOUD_BOX,
  CLOUD_BREATHE,
  CLOUD_COLLAPSED_HEIGHT_DP,
  CLOUD_TRAIL_BUBBLES,
  CLOUD_TRAIL_HEIGHT_DP,
  MIN_TOUCH_TARGET_DP,
  POSE_RANGE,
  RISE,
  RISE_STAGGER_TURNS,
  SETTLE,
  TRAIL_TRAVEL_PX,
  advancePhase,
  breatheActive,
  bubblePose,
  cloudBreathScale,
  cubicBezier,
  cssEaseInOut,
  riseFramesActive,
  type PoseInput,
  type TrailPose,
} from "./thoughtMotion";
import { BASE_PERIOD_S, MAX_PERIOD_S, MIN_PERIOD_S } from "./thinkingTiming";

const TURN_END = 1 - 1e-9;

const poseOf = (over: Partial<PoseInput>): TrailPose =>
  bubblePose({ index: 0, phase: "rise", reduced: false, riseTurns: 0, settleProgress: 0, ...over });

const expectPoseClose = (a: TrailPose, b: TrailPose) => {
  expect(a.opacity).toBeCloseTo(b.opacity, 9);
  expect(a.scale).toBeCloseTo(b.scale, 9);
  expect(a.translateY).toBeCloseTo(b.translateY, 9);
};

/**
 * Samples chosen on purpose, not spread evenly "just in case". The keyframe
 * boundaries of both gestures (0, RISE.fadeTurn, 1/3, 1/2, 2/3, 3/4) are where a
 * branch can flip, and the far end of a turn is where a fade formula usually
 * goes negative; a 1/60 sweep covers the interior of both halves, and the
 * third-of-a-turn offsets land on that grid exactly (20/60 and 40/60). Sorted
 * and deduplicated, because the monotonicity check walks the list in order.
 */
const sweep = (boundaries: readonly number[]): number[] =>
  [...new Set([0, ...boundaries, ...Array.from({ length: 61 }, (_, i) => i / 60)])].sort((a, b) => a - b);

const RISE_SAMPLES = sweep([RISE.fadeTurn, 0.5, 2 / 3, 0.75, TURN_END]);
const SETTLE_SAMPLES = sweep([SETTLE.fadeTurn, 0.5, TURN_END]);

const inRange = (value: number, range: readonly [number, number]) =>
  value >= range[0] && value <= range[1];

const expectInsideRise = (pose: TrailPose) => {
  expect(inRange(pose.opacity, POSE_RANGE.rise.opacity)).toBe(true);
  expect(inRange(pose.scale, POSE_RANGE.rise.scale)).toBe(true);
  expect(inRange(pose.translateY, POSE_RANGE.rise.translateY)).toBe(true);
};

describe("trail stagger", () => {
  it("offsets the three bubbles by exactly a third of a turn", () => {
    expect(RISE_STAGGER_TURNS).toEqual([0, 1 / 3, 2 / 3]);
    expect(RISE_STAGGER_TURNS[1] - RISE_STAGGER_TURNS[0]).toBeCloseTo(1 / 3, 12);
    expect(RISE_STAGGER_TURNS[2] - RISE_STAGGER_TURNS[1]).toBeCloseTo(1 / 3, 12);
    for (const turn of RISE_SAMPLES) {
      // Bubble 2 at turn p is bubble 0 at p + 2/3: the offset shifts one curve
      // rather than drawing three, which is why the arithmetic is identical and
      // this comparison can be exact.
      expect(poseOf({ index: 2, riseTurns: turn })).toEqual(poseOf({ index: 0, riseTurns: turn + 2 / 3 }));
      expect(poseOf({ index: 1, riseTurns: turn })).toEqual(poseOf({ index: 0, riseTurns: turn + 1 / 3 }));
    }
  });

  it("gives the three bubbles different poses at the same instant", () => {
    // A quarter of the turn before the fade-in ends: one bubble is at full
    // opacity, the second is past it and fading, the third is mid fade-in.
    const opacities = [0, 1, 2].map((index) => poseOf({ index, riseTurns: 0.125 }).opacity);
    expect(opacities[0]).toBe(0.5);
    expect(opacities[1]).toBeCloseTo(0.7222222, 6);
    expect(opacities[2]).toBeCloseTo(0.2777778, 6);
    expect(new Set(opacities).size).toBe(3);
  });

  it("treats an index outside the trail as the first bubble rather than NaN", () => {
    expect(poseOf({ index: 3, riseTurns: 0.5 })).toEqual(poseOf({ index: 0, riseTurns: 0.5 }));
  });
});

describe("rise pose", () => {
  it("stays inside its envelope at every sampled turn", () => {
    for (const index of [0, 1, 2]) {
      for (const turn of RISE_SAMPLES) expectInsideRise(poseOf({ index, riseTurns: turn }));
    }
  });

  it("stays inside its envelope for periods at both clamp ends", () => {
    // The period is not a parameter of the pose: it is spent by advancePhase
    // before the pose is asked for, which is what makes retargeting continuous.
    // So the clamp ends are exercised through the accumulator, one 16 ms frame
    // at a time, for more than a turn at the slow end.
    for (const periodMs of [MIN_PERIOD_S * 1000, BASE_PERIOD_S * 1000, MAX_PERIOD_S * 1000]) {
      let progress = 0;
      for (let frame = 0; frame < 200; frame++) {
        progress = advancePhase(progress, 16, periodMs);
        for (const index of [0, 1, 2]) expectInsideRise(poseOf({ index, riseTurns: progress }));
      }
    }
  });

  it("fades in over the first quarter of the turn and out over the rest", () => {
    expect(poseOf({ riseTurns: 0 }).opacity).toBe(0);
    expect(poseOf({ riseTurns: RISE.fadeTurn }).opacity).toBe(1);
    // Half of the remaining three quarters is the halfway point of the fade-out.
    expect(poseOf({ riseTurns: 0.625 }).opacity).toBeCloseTo(0.5, 12);
    expect(poseOf({ riseTurns: 0.5 }).opacity).toBeGreaterThan(poseOf({ riseTurns: 0.9 }).opacity);
    expect(poseOf({ riseTurns: 0.9 }).opacity).toBeLessThan(0.2);
  });

  it("shrinks as it climbs, from the answer side to the cloud side", () => {
    expect(poseOf({ riseTurns: 0 })).toEqual({ opacity: 0, scale: RISE.scaleFrom, translateY: 0 });
    expect(poseOf({ riseTurns: TURN_END }).scale).toBeCloseTo(RISE.scaleTo, 6);
    // Negative Y is up: the bubble leaves the answer and ends at the cloud.
    expect(poseOf({ riseTurns: TURN_END }).translateY).toBeCloseTo(-TRAIL_TRAVEL_PX, 6);
    expect(poseOf({ riseTurns: 0.5 }).translateY).toBe(-TRAIL_TRAVEL_PX / 2);
  });

  it("lands on the same pose a whole turn later: no jump when the pace is retargeted", () => {
    // The pose is periodic in turns, so a slower or faster period changes when
    // the bubble shows a given pose, never where it is at the moment a new token
    // rate is written. This is the property the turn accumulator exists for.
    for (const turn of RISE_SAMPLES) {
      expectPoseClose(poseOf({ riseTurns: turn + 1 }), poseOf({ riseTurns: turn }));
      expectPoseClose(poseOf({ riseTurns: turn + 3 }), poseOf({ riseTurns: turn }));
    }
  });
});

describe("settle pose", () => {
  it("moves monotonically downward and ends exactly at rest", () => {
    let previous = poseOf({ phase: "settle", settleProgress: -1 });
    expect(previous.translateY).toBe(-TRAIL_TRAVEL_PX);
    for (const progress of SETTLE_SAMPLES) {
      const pose = poseOf({ phase: "settle", settleProgress: progress });
      expect(pose.translateY).toBeGreaterThanOrEqual(previous.translateY);
      expect(pose.scale).toBeGreaterThanOrEqual(previous.scale);
      expect(pose.opacity).toBeGreaterThanOrEqual(previous.opacity);
      previous = pose;
    }
    expect(poseOf({ phase: "settle", settleProgress: 0 })).toEqual({
      opacity: 0,
      scale: SETTLE.scaleFrom,
      translateY: -TRAIL_TRAVEL_PX,
    });
    // Exactly the rest pose, not close to it: the last frame of the gesture and
    // the resting frame that follows must be the same pixels.
    expect(poseOf({ phase: "settle", settleProgress: 1 })).toEqual(poseOf({ phase: "rest" }));
  });

  it("stays inside its envelope and clamps a progress that escaped its range", () => {
    for (const progress of SETTLE_SAMPLES) {
      const pose = poseOf({ phase: "settle", settleProgress: progress });
      expect(inRange(pose.opacity, POSE_RANGE.settle.opacity)).toBe(true);
      expect(inRange(pose.scale, POSE_RANGE.settle.scale)).toBe(true);
      expect(inRange(pose.translateY, POSE_RANGE.settle.translateY)).toBe(true);
    }
    expect(poseOf({ phase: "settle", settleProgress: 1.4 })).toEqual(poseOf({ phase: "rest" }));
    expect(poseOf({ phase: "settle", settleProgress: -2 })).toEqual(poseOf({ phase: "settle", settleProgress: -1 }));
    expect(poseOf({ phase: "settle", settleProgress: Number.NaN })).toEqual(poseOf({ phase: "settle", settleProgress: 0 }));
  });

  it("takes its opacity from the settle curve, not the rise curve", () => {
    expect(poseOf({ phase: "settle", settleProgress: SETTLE.fadeTurn }).opacity).toBe(1);
    expect(poseOf({ phase: "settle", settleProgress: SETTLE.fadeTurn / 2 }).opacity).toBeCloseTo(0.5, 12);
  });
});

describe("still poses", () => {
  it("holds the rest pose at rest, whatever the progress values happen to be", () => {
    for (const riseTurns of RISE_SAMPLES) {
      for (const settleProgress of SETTLE_SAMPLES) {
        expect(poseOf({ phase: "rest", riseTurns, settleProgress })).toEqual({ opacity: 1, scale: 1, translateY: 0 });
      }
    }
  });

  it("holds the rest pose under reduce motion, at any phase and any progress", () => {
    for (const phase of ["rise", "settle", "rest"] as const) {
      for (const riseTurns of RISE_SAMPLES) {
        const pose = poseOf({ phase, reduced: true, riseTurns, settleProgress: 0.4 });
        expect(pose).toEqual({ opacity: 1, scale: 1, translateY: 0 });
      }
    }
  });

  it("runs the rise's frame callback only while rising, and never under reduce motion", () => {
    expect(riseFramesActive("rise", false)).toBe(true);
    expect(riseFramesActive("rise", true)).toBe(false);
    expect(riseFramesActive("settle", false)).toBe(false);
    expect(riseFramesActive("rest", false)).toBe(false);
    expect(riseFramesActive("settle", true)).toBe(false);
    expect(riseFramesActive("rest", true)).toBe(false);
  });

  it("breathes while working and only then, and not under reduce motion", () => {
    expect(breatheActive(true, false)).toBe(true);
    expect(breatheActive(false, false)).toBe(false);
    expect(breatheActive(true, true)).toBe(false);
    expect(breatheActive(false, true)).toBe(false);
  });
});

describe("touch target", () => {
  it("clears the 48dp the row used to miss", () => {
    expect(MIN_TOUCH_TARGET_DP).toBeGreaterThanOrEqual(48);
    expect(Number.isInteger(MIN_TOUCH_TARGET_DP)).toBe(true);
  });
});

describe("phase accumulator", () => {
  it("advances by dt/period and wraps into [0,1)", () => {
    expect(advancePhase(0, 100, 1000)).toBeCloseTo(0.1, 12);
    expect(advancePhase(0.9, 200, 1000)).toBeCloseTo(0.1, 12);
    expect(advancePhase(0.5, 0, 1000)).toBe(0.5);
    expect(advancePhase(0, 2600, 2600)).toBe(0);
    for (let frame = 0; frame < 500; frame++) {
      const next = advancePhase(frame / 500, 17, MIN_PERIOD_S * 1000);
      expect(next).toBeGreaterThanOrEqual(0);
      expect(next).toBeLessThan(1);
    }
  });

  it("ignores the first frame (null dt) and a period that is not positive", () => {
    expect(advancePhase(0.25, null, 1000)).toBe(0.25);
    expect(advancePhase(0.25, undefined, 1000)).toBe(0.25);
    expect(advancePhase(0.25, 16, 0)).toBe(0.25);
    expect(advancePhase(0.25, 16, Number.NaN)).toBe(0.25);
    expect(advancePhase(0.25, 16, -1000)).toBe(0.25);
  });

  it("retargets the slope without moving the position", () => {
    const slow = advancePhase(0.4, 16, MAX_PERIOD_S * 1000);
    const fast = advancePhase(0.4, 16, MIN_PERIOD_S * 1000);
    // The slower period moves less and the faster one more, and neither of them
    // jumps: both stay inside one frame at their own pace, not one period of it.
    expect(slow).toBeGreaterThan(0.4);
    expect(fast).toBeGreaterThan(slow);
    expect(slow - 0.4).toBeCloseTo(16 / (MAX_PERIOD_S * 1000), 12);
    expect(fast - 0.4).toBeCloseTo(16 / (MIN_PERIOD_S * 1000), 12);
  });
});

describe("breathe envelope", () => {
  it("starts at 1, peaks at the half cycle and returns to 1", () => {
    expect(cloudBreathScale(0)).toBe(1);
    expect(cloudBreathScale(0.5)).toBeCloseTo(CLOUD_BREATHE.peak, 6);
    expect(cloudBreathScale(1)).toBe(1);
    expect(CLOUD_BREATHE.cycleMs).toBe(2600);
  });

  it("stays inside [1, peak] and rises then falls", () => {
    let previous = cloudBreathScale(0);
    for (let i = 1; i <= 50; i++) {
      const scale = cloudBreathScale(i / 100);
      expect(scale).toBeGreaterThanOrEqual(previous);
      expect(scale).toBeLessThanOrEqual(CLOUD_BREATHE.peak);
      previous = scale;
    }
    for (let i = 51; i <= 100; i++) {
      const scale = cloudBreathScale(i / 100);
      expect(scale).toBeLessThanOrEqual(previous);
      expect(scale).toBeGreaterThanOrEqual(1);
      previous = scale;
    }
  });

  it("is symmetric, so the two halves of the breath are the same breath", () => {
    for (let i = 0; i <= 50; i++) {
      const t = i / 100;
      expect(cloudBreathScale(t)).toBeCloseTo(cloudBreathScale(1 - t), 9);
    }
  });
});

describe("css easing", () => {
  it("matches the published cubic-bezier(0.42, 0, 0.58, 1) curve", () => {
    // The reference values of CSS `ease-in-out`, the curve the port owes.
    expect(cssEaseInOut(0)).toBe(0);
    expect(cssEaseInOut(0.25)).toBeCloseTo(0.12916193, 6);
    expect(cssEaseInOut(0.5)).toBeCloseTo(0.5, 6);
    expect(cssEaseInOut(0.75)).toBeCloseTo(0.87083807, 6);
    expect(cssEaseInOut(1)).toBe(1);
  });

  it("is monotone, and not the `ease` curve it was written as", () => {
    let previous = 0;
    for (let i = 0; i <= 100; i++) {
      const y = cssEaseInOut(i / 100);
      expect(y).toBeGreaterThanOrEqual(previous);
      previous = y;
    }
    // Easing.ease is cubic-bezier(0.42, 0, 1, 1). Telling the two apart is the
    // whole point of spelling the control points out.
    expect(cubicBezier(0.42, 0, 1, 1, 0.25)).toBeCloseTo(0.0934647, 6);
    expect(cubicBezier(0.42, 0, 1, 1, 0.5)).toBeCloseTo(0.3153568, 6);
    expect(cubicBezier(0.42, 0, 1, 1, 0.5)).toBeLessThan(cssEaseInOut(0.5));
  });

  it("answers both endpoints exactly and clamps what is outside them", () => {
    expect(cubicBezier(0.42, 0, 0.58, 1, -1)).toBe(0);
    expect(cubicBezier(0.42, 0, 0.58, 1, 2)).toBe(1);
    expect(cssEaseInOut(Number.NaN)).toBe(0);
  });
});

describe("the cloud's collapsed box", () => {
  it("is the sum of the parts the component draws with", () => {
    // 6 margin + (9 + 7 + 5) bubbles + 2 x 4 gap - 9 pulled back up.
    expect(CLOUD_TRAIL_HEIGHT_DP).toBe(26);
    expect(CLOUD_COLLAPSED_HEIGHT_DP).toBe(
      2 * CLOUD_BOX.border +
        CLOUD_BOX.paddingTop +
        MIN_TOUCH_TARGET_DP +
        CLOUD_BOX.paddingBottom +
        CLOUD_TRAIL_HEIGHT_DP,
    );
    // 2 border + 8.8 + 48 head + 10.4 + 26 trail.
    expect(CLOUD_COLLAPSED_HEIGHT_DP).toBeCloseTo(95.2, 6);
    // Taller than the head row alone: the trail is part of what must clear.
    expect(CLOUD_COLLAPSED_HEIGHT_DP).toBeGreaterThan(MIN_TOUCH_TARGET_DP);
  });

  it("keeps the trail widest to narrowest, each inset deeper than the last", () => {
    expect(CLOUD_TRAIL_BUBBLES.map((bubble) => bubble.size)).toEqual([9, 7, 5]);
    const insets = CLOUD_TRAIL_BUBBLES.map((bubble) => bubble.inset);
    for (let i = 1; i < insets.length; i++) expect(insets[i]).toBeGreaterThan(insets[i - 1]);
  });
});
