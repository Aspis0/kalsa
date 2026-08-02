import React, { useEffect } from "react";
import { View, Text, ViewStyle, StyleProp } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useLabTheme } from "../../ui/labTheme";
import { radius, spacing } from "../tokens";
import { typography } from "../typography";

type Tone = "neutral" | "accent" | "good" | "warn" | "bad" | "teal";

type Props = {
  tone?: Tone;
  dot?: boolean;
  pulse?: boolean;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

const toneToColor: Record<Tone, string> = {
  neutral: "muted",
  accent: "accent",
  good: "good",
  warn: "warn",
  bad: "bad",
  teal: "compute",
};

export function Pill({ tone = "neutral", dot = false, pulse = false, children, style }: Props) {
  const { colors } = useLabTheme<any>();
  const color = colors[toneToColor[tone]];
  const bg = tone === "neutral" ? colors.panelBright : `${color}26`;
  const text = tone === "neutral" ? colors.ink : color;
  const dotColor = tone === "neutral" ? colors.muted : color;

  const opacity = useSharedValue(1);

  useEffect(() => {
    if (pulse && dot) {
      opacity.value = withRepeat(
        withSequence(
          withTiming(0.55, { duration: 700, easing: Easing.inOut(Easing.ease) }),
          withTiming(1, { duration: 700, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
        false,
      );
    } else {
      cancelAnimation(opacity);
      opacity.value = 1;
    }
    return () => cancelAnimation(opacity);
  }, [pulse, dot, opacity]);

  // Short-circuit the worklet when the dot is not animated: avoids per-frame
  // UI-thread reads on Pill instances that don't pulse (the vast majority).
  const animatedDotStyle = useAnimatedStyle(() =>
    pulse && dot ? { opacity: opacity.value } : {},
  );

  return (
    <View
      style={[
        {
          backgroundColor: bg,
          borderRadius: radius.pill,
          paddingHorizontal: spacing.sm,
          paddingVertical: 2,
          alignSelf: "flex-start",
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
        },
        style,
      ]}
    >
      {dot ? (
        <Animated.View
          style={[
            {
              width: 5,
              height: 5,
              borderRadius: 999,
              backgroundColor: dotColor,
            },
            pulse ? animatedDotStyle : undefined,
          ]}
        />
      ) : null}
      <Text style={[typography.monoXs, { color: text }]}>{children}</Text>
    </View>
  );
}
