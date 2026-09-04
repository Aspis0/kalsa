import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo } from "react-native";
import {
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

function clamp01(v: number) {
  "worklet";
  return Math.max(0, Math.min(1, v));
}

function lerp(a: number, b: number, t: number) {
  "worklet";
  return a + (b - a) * t;
}

function smooth(t: number) {
  "worklet";
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

/** Demo openDrawer staged curve: time x∈[0,1] → progress. */
function openMap(x: number) {
  "worklet";
  const t = clamp01(x);
  if (t < 0.2) return lerp(0, 0.22, smooth(t / 0.2));
  if (t < 0.82) {
    const u0 = (t - 0.2) / 0.62;
    const u =
      u0 < 0.35
        ? (u0 / 0.35) * (u0 / 0.35) * 0.35
        : u0 < 0.7
          ? lerp(0.35, 0.78, (u0 - 0.35) / 0.35)
          : lerp(0.78, 1, 1 - Math.pow(1 - (u0 - 0.7) / 0.3, 2));
    return lerp(0.22, 0.9, u);
  }
  return lerp(0.9, 1, smooth((t - 0.82) / 0.18));
}

/** Inverse easing for withTiming(0): demo closeDrawer two-stage settle. */
function closeEased(x: number, from: number) {
  "worklet";
  if (from < 0.001) return 1;
  const t = clamp01(x);
  let v: number;
  if (from < 0.25) v = lerp(from, 0, smooth(t));
  else if (t < 0.55) v = lerp(from, 0.18, smooth(t / 0.55));
  else v = lerp(0.18, 0, smooth((t - 0.55) / 0.45));
  return 1 - v / from;
}

function flapScaleX(v: number, reduced: number) {
  "worklet";
  if (reduced) return 1;
  return interpolate(smooth(clamp01((v - 0.18) / 0.7)), [0, 1], [-1, 1]);
}

function paperScale(v: number, reduced: number) {
  "worklet";
  if (reduced) return interpolate(smooth(v), [0, 1], [0.18, 1]);
  return interpolate(smooth(clamp01(v / 0.28)), [0, 1], [0.12, 1]);
}

const CONTENT_LIVE_V = 0.897;

export function useLeafFold(open: boolean) {
  const progress = useSharedValue(open ? 1 : 0);
  const reduceSv = useSharedValue(0);
  const closeFromSv = useSharedValue(1);
  const [mounted, setMounted] = useState(open);
  const [contentLive, setContentLive] = useState(open);
  const [backdropLive, setBackdropLive] = useState(open);
  const reduceRef = useRef(false);
  const mountedRef = useRef(open);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const setContentLiveGuarded = useCallback((v: boolean) => {
    if (aliveRef.current) setContentLive(v);
  }, []);
  const setBackdropLiveGuarded = useCallback((v: boolean) => {
    if (aliveRef.current) setBackdropLive(v);
  }, []);
  const setMountedGuarded = useCallback((v: boolean) => {
    if (aliveRef.current) setMounted(v);
  }, []);

  useEffect(() => {
    const apply = (v: boolean) => {
      reduceRef.current = v;
      reduceSv.value = v ? 1 : 0;
    };
    AccessibilityInfo.isReduceMotionEnabled()
      .then(apply)
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", apply);
    return () => sub.remove();
  }, [reduceSv]);

  useEffect(() => {
    const rm = reduceRef.current;
    if (open) {
      mountedRef.current = true;
      setMounted(true);
      if (progress.value >= 0.999) {
        setContentLive(true);
        setBackdropLive(true);
        return;
      }
      const from = progress.value;
      progress.value = withTiming(1, {
        duration: rm ? 240 : 1400,
        easing: rm
          ? (t) => {
              "worklet";
              return smooth(t);
            }
          : from < 0.05
            ? (t) => {
                "worklet";
                return openMap(t);
              }
            : (t) => {
                "worklet";
                return smooth(t);
              },
      });
      return;
    }
    if (!mountedRef.current) return;
    closeFromSv.value = progress.value;
    progress.value = withTiming(
      0,
      {
        duration: rm ? 200 : 980,
        easing: rm
          ? (t) => {
              "worklet";
              return t * t;
            }
          : (t) => {
              "worklet";
              return closeEased(t, closeFromSv.value);
            },
      },
      (finished) => {
        if (finished) {
          mountedRef.current = false;
          runOnJS(setMountedGuarded)(false);
        }
      },
    );
  }, [open, progress, closeFromSv]);

  useAnimatedReaction(
    () => progress.value > CONTENT_LIVE_V,
    (live, prev) => {
      if (live !== prev) runOnJS(setContentLiveGuarded)(live);
    },
  );

  useAnimatedReaction(
    () => progress.value > 0.05,
    (live, prev) => {
      if (live !== prev) runOnJS(setBackdropLiveGuarded)(live);
    },
  );

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
  }));

  const paperStyle = useAnimatedStyle(() => {
    const v = progress.value;
    return {
      transform: [{ scale: paperScale(v, reduceSv.value) }],
      opacity: v > 0.008 ? 1 : 0,
    };
  });

  const flapStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: flapScaleX(progress.value, reduceSv.value) }],
  }));

  const flapFrontStyle = useAnimatedStyle(() => ({
    opacity: flapScaleX(progress.value, reduceSv.value) < 0 ? 0 : 1,
  }));

  const flapBackStyle = useAnimatedStyle(() => ({
    opacity: flapScaleX(progress.value, reduceSv.value) < 0 ? 1 : 0,
  }));

  const contentStyle = useAnimatedStyle(() => {
    const v = progress.value;
    if (reduceSv.value) {
      return { opacity: smooth(v), transform: [{ translateY: 0 }] };
    }
    const late = clamp01((v - 0.78) / 0.18);
    return { opacity: late, transform: [{ translateY: (1 - late) * 8 }] };
  });

  const creaseStyle = useAnimatedStyle(() => {
    const v = progress.value;
    const sx = flapScaleX(v, reduceSv.value);
    const edgeAmt = 1 - Math.abs(sx);
    const motion = clamp01((0.92 - v) / 0.12) * clamp01((v - 0.08) / 0.12);
    return { opacity: edgeAmt * motion * 0.85 };
  });

  const shadeStyle = useAnimatedStyle(() => {
    const v = progress.value;
    const sx = flapScaleX(v, reduceSv.value);
    const edgeAmt = 1 - Math.abs(sx);
    const motion = clamp01((0.92 - v) / 0.12) * clamp01((v - 0.08) / 0.12);
    return { opacity: edgeAmt * motion * 0.55 };
  });

  return {
    mounted,
    contentLive,
    backdropLive,
    backdropStyle,
    paperStyle,
    flapStyle,
    flapFrontStyle,
    flapBackStyle,
    contentStyle,
    creaseStyle,
    shadeStyle,
  };
}
