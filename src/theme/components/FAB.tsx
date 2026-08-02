import React from "react";
import { Pressable, View } from "react-native";
import { Camera } from "lucide-react-native";
import { useLabTheme } from "../../ui/labTheme";
import { shadows } from "../tokens";

type Props = {
  onPress: () => void;
  onLongPress?: () => void;
  size?: number;
};

// Center floating action button. Anchors visually in the middle of TabBar
// but is rendered as a separate absolutely-positioned element so it can
// overflow above the bar (the iconic look on Material/iOS).
// tap = camera (Biovision flow), long-press = QuickActionSheet trigger.
export function FAB({ onPress, onLongPress, size = 56 }: Props) {
  const { colors } = useLabTheme<any>();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      hitSlop={10}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: pressed ? colors.accentDeep : colors.accent,
        alignItems: "center",
        justifyContent: "center",
        ...shadows.accent,
      })}
    >
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: size / 2,
          borderTopLeftRadius: size / 2,
          borderTopRightRadius: size / 2,
          backgroundColor: "rgba(255, 255, 255, 0.12)",
        }}
      />
      <Camera color={colors.primaryText} size={26} />
    </Pressable>
  );
}
