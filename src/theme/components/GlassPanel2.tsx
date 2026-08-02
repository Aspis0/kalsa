import React from "react";
import { Platform, StyleSheet, View, ViewStyle, StyleProp } from "react-native";
import { BlurView } from "expo-blur";
import { useLabTheme } from "../../ui/labTheme";
import { radius } from "../tokens";

type Props = {
  intensity?: number;
  rounded?: keyof typeof radius;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
};

// 2-layer glass: BlurView (tinted) + inset highlight overlay.
// Replaces the 8-layer GlassPrimitives.GlassPanel for nav/modal/sheet/drawer.
// On light theme, BlurView with tint "light" + subtle dark tint overlay.
// On dark theme, BlurView with tint "dark" + subtle white highlight overlay.
export function GlassPanel2({ intensity = 28, rounded = "lg", style, children }: Props) {
  const { palette, colors } = useLabTheme<any>();
  const tint: "light" | "dark" = palette?.blurTint === "light" ? "light" : "dark";
  const isDark = tint === "dark";

  return (
    <View
      style={[
        {
          borderRadius: radius[rounded],
          overflow: "hidden",
          borderWidth: 1,
          borderColor: isDark
            ? "rgba(255, 255, 255, 0.12)"
            : "rgba(20, 25, 35, 0.08)",
        },
        style,
      ]}
    >
      <BlurView
        intensity={Platform.OS === "android" ? Math.min(intensity, 24) : intensity}
        tint={tint}
        style={StyleSheet.absoluteFill}
      />
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: isDark ? colors.blackGlass : "rgba(255, 255, 255, 0.55)",
          },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            borderTopWidth: 1,
            borderTopColor: isDark
              ? "rgba(255, 255, 255, 0.10)"
              : "rgba(255, 255, 255, 0.85)",
            borderRadius: radius[rounded],
          },
        ]}
      />
      <View>{children}</View>
    </View>
  );
}
