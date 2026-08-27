import React from "react";
import { View, ViewStyle, StyleProp } from "react-native";
import { useLabTheme } from "../../ui/labTheme";
import { radius, shadows, spacing } from "../tokens";

type Variant = "subtle" | "regular" | "strong";

type Props = {
  variant?: Variant;
  padded?: boolean;
  rounded?: keyof typeof radius;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
};

// Flat content card. NO glass — for that use GlassPanel2.
// Use this for Recents cards, list rows, tool tiles, info blocks.
export function Surface({
  variant = "regular",
  padded = true,
  rounded = "md",
  style,
  children,
}: Props) {
  const { colors } = useLabTheme<any>();

  const base: ViewStyle = {
    borderRadius: radius[rounded],
    padding: padded ? spacing.md : 0,
    overflow: "hidden",
  };

  let variantStyle: ViewStyle;
  switch (variant) {
    case "subtle":
      variantStyle = {
        backgroundColor: colors.panel,
        borderWidth: 1,
        borderColor: colors.line,
      };
      break;
    case "strong":
      variantStyle = {
        backgroundColor: colors.surfaceElev,
        borderWidth: 1,
        borderColor: colors.line,
        ...shadows.soft,
      };
      break;
    case "regular":
    default:
      variantStyle = {
        backgroundColor: colors.surfaceElev,
        borderWidth: 1,
        borderColor: colors.line,
      };
  }

  return <View style={[base, variantStyle, style]}>{children}</View>;
}
