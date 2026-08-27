import React from "react";
import { StyleProp, View, ViewStyle } from "react-native";
import { useLabTheme } from "../../ui/labTheme";
import { spacing } from "../tokens";

type Props = {
  children?: React.ReactNode;
  position?: "top" | "bottom" | "inline";
  style?: StyleProp<ViewStyle>;
};

export function Toolbar({ children, position = "inline", style }: Props) {
  const { colors } = useLabTheme<any>();
  const borderStyle: ViewStyle =
    position === "bottom"
      ? { borderTopColor: colors.line, borderTopWidth: 1 }
      : position === "top"
        ? { borderBottomColor: colors.line, borderBottomWidth: 1 }
        : {};

  return (
    <View
      style={[
        {
          alignItems: "center",
          flexDirection: "row",
          gap: spacing.sm,
          minHeight: 48,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
        },
        borderStyle,
        style,
      ]}
    >
      {children}
    </View>
  );
}
