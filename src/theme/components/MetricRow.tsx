import React from "react";
import { View, Text, ViewStyle, StyleProp } from "react-native";
import { useLabTheme } from "../../ui/labTheme";
import { spacing } from "../tokens";
import { typography } from "../typography";

type Props = {
  label: string;
  value: string | React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function MetricRow({ label, value, style }: Props) {
  const { colors } = useLabTheme<any>();
  return (
    <View
      style={[
        {
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          paddingVertical: spacing.xs,
        },
        style,
      ]}
    >
      <Text style={[typography.bodySm, { color: colors.muted }]}>{label}</Text>
      {typeof value === "string" ? (
        <Text style={[typography.monoSm, { color: colors.ink }]}>{value}</Text>
      ) : (
        value
      )}
    </View>
  );
}
