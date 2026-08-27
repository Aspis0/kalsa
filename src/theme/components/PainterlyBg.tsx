import React from "react";
import { StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useLabTheme } from "../../ui/labTheme";

// Painterly background — 3 stacked gradients that match the Agora website's
// living dark surface (teal wash + warm orange wash + diagonal dark base).
// On light theme, we use a cream wash instead.
// Place this as the first child of any full-screen container, behind content.
export function PainterlyBg() {
  const { palette, colors } = useLabTheme<any>();
  const isDark = palette?.blurTint !== "light";

  if (isDark) {
    return (
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <LinearGradient
          colors={[colors.materialTop, colors.materialMid, colors.materialBottom]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          colors={[colors.glowMid, "transparent"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0.6 }}
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          colors={["transparent", "transparent", colors.glowTop]}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </View>
    );
  }

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient
        colors={[colors.materialTop, colors.materialMid, colors.materialBottom]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={[colors.glowMid, "transparent"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0.6 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={["transparent", colors.glowTop]}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}
