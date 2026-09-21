/**
 * The model's thinking as a cloud above its answer: a lumpy cloud, a one-line
 * face showing the live tail of the reasoning, a disclosure, and a trail of
 * three shrinking bubbles — this thought produced that sentence.
 *
 * The trail moves with meaning: while thinking the bubbles rise into the cloud
 * at the real token rate; when the answer starts they settle once; at rest
 * nothing moves. Port of kalsa-brain/chat/src/components/ThoughtCloud.tsx +
 * ThoughtCloud.css — the numbers live in ./thinkingTiming.ts and
 * ./thoughtMotion.ts, what is here is the drawing.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing, cancelAnimation, useAnimatedStyle, useFrameCallback, useSharedValue,
  withDelay, withRepeat, withTiming, type FrameInfo, type SharedValue,
} from "react-native-reanimated";
import {
  CLOUD_BOX, CLOUD_BREATHE, CLOUD_TRAIL_BUBBLES, MIN_TOUCH_TARGET_DP, advancePhase, breatheActive,
  bubblePose, cloudBreathScale, riseFramesActive,
} from "./thoughtMotion";
import {
  BASE_PERIOD_S, SETTLE_DURATION_MS, SETTLE_STAGGER_MS, createTimingState,
  onMode, onToken, phaseAt, thinkingSummary, tickerText, type ThinkingPhase, type TimingState,
} from "./thinkingTiming";

/** The green family the owner fixed. A theme module owns the real values. */
export type ThoughtCloudColors = {
  page: string; surface: string; surfaceMuted: string;
  border: string; borderStrong: string;
  ink: string; inkSoft: string; silence: string; accent: string;
};

export type ThoughtCloudLabels = { show?: string; hide?: string; region?: string };

export type ThoughtCloudProps = {
  messageId: string;
  reasoning: string;
  reasoningMs?: number;
  /** Reasoning tokens are still arriving. */
  working: boolean;
  /** Answer text has started arriving. */
  answered: boolean;
  /** Latest reasoning line, tracked incrementally upstream (O(chunk)). */
  tail?: string;
  colors: ThoughtCloudColors;
  labels?: ThoughtCloudLabels;
};

/** The desktop stylesheet is rem-based; one rem is what the browser used. */
const REM = 16;
/** CSS `ease-out`, which is not `Easing.out(Easing.cubic)`.
 *  It MUST come from reanimated: `withTiming` runs its easing on the UI runtime,
 *  and React Native's own `Easing` is a plain JavaScript closure, so taking it
 *  from `react-native` kills the app on mount with "Tried to synchronously call
 *  a Remote Function" (Worklets). `thoughtCloudWorklets.test.ts` guards this. */
const CSS_EASE_OUT = Easing.bezier(0, 0, 0.58, 1);
const BODY_MAX_HEIGHT = 320;

/** A monotonic clock where the runtime has one; the window only reads deltas. */
const clock = (): number =>
  typeof globalThis.performance?.now === "function" ? globalThis.performance.now() : Date.now();
function makeStyles(colors: ThoughtCloudColors) {
  return StyleSheet.create({
    cloud: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderWidth: CLOUD_BOX.border,
      // The CSS radii are elliptical (`24px 28px 26px 18px / 20px 26px 18px
      // 28px`) and RN has no elliptical corners, so the horizontal set stands in.
      borderTopLeftRadius: 24,
      borderTopRightRadius: 28,
      borderBottomRightRadius: 26,
      borderBottomLeftRadius: 18,
      marginBottom: 0.35 * REM,
      paddingBottom: CLOUD_BOX.paddingBottom,
      paddingHorizontal: REM,
      paddingTop: CLOUD_BOX.paddingTop,
      position: "relative",
    },
    // Puffs: background only, no border — a ring would cut across the bubble.
    puff: { backgroundColor: colors.surface, borderRadius: 999, position: "absolute" },
    puffBig: { height: 26, left: 30, top: -9, width: 26 },
    puffSmall: { height: 15, right: 52, top: -6, width: 15 },
    // The 48dp floor is a real height, not a hitSlop: a row as tall as its type
    // (~34dp) is a mis-tap on a 3-inch screen. Centering keeps the small caps
    // where the eye expects them once the row is taller than its text.
    head: {
      alignItems: "center", flexDirection: "row", gap: REM,
      justifyContent: "space-between", minHeight: MIN_TOUCH_TARGET_DP,
    },
    // The thought ranks below the answer: quiet ink, smaller, never competing.
    face: { color: colors.silence, flex: 1, flexShrink: 1, fontSize: 0.84 * REM, fontStyle: "italic" },
    // The accent lives only on the clickable part.
    toggle: { color: colors.accent, flexShrink: 0, fontSize: 0.78 * REM, fontWeight: "500" },
    body: {
      borderStyle: "dashed", borderTopColor: colors.borderStrong, borderTopWidth: 1,
      marginTop: 0.55 * REM, maxHeight: BODY_MAX_HEIGHT, paddingTop: 0.55 * REM,
    },
    bodyText: { color: colors.silence, fontSize: 0.86 * REM, lineHeight: 1.65 * 0.86 * REM },
    trail: { flexDirection: "column", gap: CLOUD_BOX.trailGap, marginBottom: CLOUD_BOX.trailMarginBottom, marginLeft: 44, marginTop: CLOUD_BOX.trailMarginTop },
    bubble: { backgroundColor: colors.surface, borderColor: colors.borderStrong, borderRadius: 999, borderWidth: 1 },
  });
}

type TrailBubbleProps = {
  index: number;
  size: number;
  inset: number;
  phase: SharedValue<ThinkingPhase>;
  reduced: SharedValue<boolean>;
  rise: SharedValue<number>;
  settle: SharedValue<number>;
  styles: ReturnType<typeof makeStyles>;
};

/**
 * One bubble of the trail. The style is a worklet, so a frame of motion costs no
 * render, and the pose comes from the pure module: this component never turns a
 * progress value into a pixel itself.
 */
function TrailBubble({ index, inset, phase, reduced, rise, settle, size, styles }: TrailBubbleProps) {
  const motion = useAnimatedStyle(() => {
    const pose = bubblePose({
      index,
      phase: phase.value,
      reduced: reduced.value,
      riseTurns: rise.value,
      settleProgress: settle.value,
    });
    return {
      opacity: pose.opacity,
      transform: [{ translateY: pose.translateY }, { scale: pose.scale }],
    };
  });

  return <Animated.View style={[styles.bubble, { height: size, marginLeft: inset, width: size }, motion]} />;
}

function ThoughtCloudView({
  answered,
  colors,
  labels,
  messageId,
  reasoning,
  reasoningMs,
  tail,
  working,
}: ThoughtCloudProps) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const rising = working && !answered;
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<ThinkingPhase>(rising ? "rise" : "rest");
  const [reduced, setReduced] = useState(false);
  const timing = useRef<TimingState>(createTimingState());

  // Reanimated, not plain Animated: the rise's period is retargeted up to three
  // times a second, and a looping Animated.timing can only be re-paced by
  // restarting it from a fixed phase, which reads as a stutter.
  const rise = useSharedValue(0);
  const settle0 = useSharedValue(0);
  const settle1 = useSharedValue(0);
  const settle2 = useSharedValue(0);
  const settles = useMemo(() => [settle0, settle1, settle2], [settle0, settle1, settle2]);
  // Seeded, not defaulted: the first painted frame must already be in the right
  // pose, or a mount that is already reasoning flashes a visible resting trail.
  const phaseSv = useSharedValue<ThinkingPhase>(rising ? "rise" : "rest");
  const reducedSv = useSharedValue(false);
  const periodMs = useSharedValue(BASE_PERIOD_S * 1000);
  const breath = useSharedValue(1);

  useEffect(() => {
    let alive = true;
    const apply = (on: boolean) => {
      if (!alive) return;
      reducedSv.value = on;
      setReduced(on);
    };
    AccessibilityInfo.isReduceMotionEnabled().then(apply).catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", apply);
    return () => {
      alive = false;
      sub.remove();
    };
  }, [reducedSv]);

  // The phase machine: two renders per message, at the rise and at the answer.
  useEffect(() => {
    const at = clock();
    const next = onMode(timing.current, at, { working, answered });
    timing.current = next;
    const nextPhase = phaseAt(next, at);
    setPhase((current) => (current === nextPhase ? current : nextPhase));
    if (nextPhase !== "settle" || next.settlingUntil === null) return;
    const back = () => setPhase((current) => (current === "settle" ? "rest" : current));
    const timer = setTimeout(back, next.settlingUntil - at);
    return () => clearTimeout(timer);
  }, [answered, working]);

  // The heartbeat: a token feeds the window, and a throttled sample retargets the
  // pace. This is the whole per-token path — a ref and a shared value, no
  // setState, so a token never re-renders this component and never touches the
  // animation frame; the pace is written at most ~3 times a second. The face text
  // is the parent's own render, as in the desktop, and is not repeated here.
  useEffect(() => {
    if (!rising) return;
    const tick = onToken(timing.current, clock());
    timing.current = tick.state;
    if (tick.wrote) periodMs.value = tick.state.period * 1000;
  }, [reasoning, tail, rising, periodMs]);

  useEffect(() => {
    const stop = (value: SharedValue<number>) => {
      cancelAnimation(value);
      value.value = 0;
    };
    if (phase !== "settle") {
      phaseSv.value = phase;
      rise.value = 0; // a fresh gesture starts at the answer side
      settles.forEach(stop);
      return;
    }
    phaseSv.value = "settle";
    // Reduced motion keeps the trail as a still connector: the policy is ours,
    // never the library's, so the bubbles hold the resting pose instead of being
    // jumped to the end of a gesture they were not allowed to run.
    if (reduced) {
      settles.forEach(stop);
      return;
    }
    settles.forEach((value, index) => {
      stop(value);
      value.value = withDelay(SETTLE_STAGGER_MS[index], withTiming(1, { duration: SETTLE_DURATION_MS, easing: CSS_EASE_OUT }));
    });
  }, [phase, reduced, rise, phaseSv, settles]);

  useEffect(() => {
    if (!breatheActive(working, reduced)) {
      cancelAnimation(breath);
      breath.value = 1;
      return;
    }
    breath.value = 0;
    // Linear on purpose: the ramp is the clock and cloudBreathScale is the
    // envelope, so the curve is the CSS one by construction and by test.
    breath.value = withRepeat(withTiming(1, { duration: CLOUD_BREATHE.cycleMs, easing: Easing.linear }), -1, false);
    return () => {
      cancelAnimation(breath);
      breath.value = 1;
    };
  }, [breath, reduced, working]);

  // The rise is clocked on the UI thread by an accumulator rather than a
  // restarted loop, so retargeting the pace never shows as a stutter. Two traps:
  // `autostart` is honoured only on the first render, so activation is explicit;
  // memoising on the shared values stops a parent re-render (one per token) from
  // making the hook re-register the callback.
  const onFrame = useCallback(
    (frameInfo: FrameInfo) => {
      "worklet";
      rise.value = advancePhase(rise.value, frameInfo.timeSincePreviousFrame, periodMs.value);
    },
    [rise, periodMs],
  );
  const frame = useFrameCallback(onFrame, false);

  useEffect(() => {
    frame.setActive(riseFramesActive(phase, reduced));
  }, [frame, phase, reduced]);

  const breatheStyle = useAnimatedStyle(() => ({ transform: [{ scale: cloudBreathScale(breath.value) }] }));
  const face = working ? tickerText(tail, reasoning) : thinkingSummary(reasoningMs);
  const bodyId = `thought-${messageId}-body`;

  return (
    <Animated.View style={[styles.cloud, breatheActive(working, reduced) ? breatheStyle : null]} testID={`thought-${messageId}`}>
      <View pointerEvents="none" style={[styles.puff, styles.puffBig]} />
      <View pointerEvents="none" style={[styles.puff, styles.puffSmall]} />
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((was) => !was)}
        style={styles.head}
        testID={`thought-${messageId}-head`}
      >
        <Text ellipsizeMode="tail" numberOfLines={1} style={styles.face}>
          {face}
        </Text>
        <Text style={styles.toggle}>{open ? labels?.hide ?? "Hide ▲" : labels?.show ?? "Show thinking ▼"}</Text>
      </Pressable>
      {open ? (
        <ScrollView
          accessibilityLabel={labels?.region ?? "Model thinking"}
          accessibilityRole="text"
          accessible
          nestedScrollEnabled
          style={styles.body}
          testID={bodyId}
        >
          <Text style={styles.bodyText}>{reasoning}</Text>
        </ScrollView>
      ) : null}
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.trail}
        testID={`thought-${messageId}-trail`}
      >
        {CLOUD_TRAIL_BUBBLES.map((bubble, index) => (
          <TrailBubble
            index={index}
            inset={bubble.inset}
            key={bubble.size}
            phase={phaseSv}
            reduced={reducedSv}
            rise={rise}
            settle={settles[index]}
            size={bubble.size}
            styles={styles}
          />
        ))}
      </View>
    </Animated.View>
  );
}

/** `labels` is small and usually written inline at the call site, so compare its fields, not its identity. */
function sameLabels(a: ThoughtCloudLabels | undefined, b: ThoughtCloudLabels | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return a.show === b.show && a.hide === b.hide && a.region === b.region;
}

/**
 * Every resting cloud in the transcript re-renders on every keystroke and every
 * token of a new message, because the list re-renders for the composer. A
 * finished message's props do not change, so the memo holds for exactly the
 * clouds that are not animating — which is where the cost was.
 *
 * `colors` is compared by IDENTITY on purpose, and that is the whole trap: a
 * theme object rebuilt per render defeats this memo silently, because a
 * re-render is not an error and nothing on screen shows it. Pass the stable
 * object from the design layer (`modes[mode]`), not a fresh literal.
 */
function sameThoughtCloud(a: ThoughtCloudProps, b: ThoughtCloudProps): boolean {
  return a.messageId === b.messageId && a.reasoning === b.reasoning && a.tail === b.tail
    && a.reasoningMs === b.reasoningMs && a.working === b.working && a.answered === b.answered
    && a.colors === b.colors && sameLabels(a.labels, b.labels);
}

export const ThoughtCloud = React.memo(ThoughtCloudView, sameThoughtCloud);
