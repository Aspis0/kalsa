import React from "react";
import { Text, View } from "react-native";
import { useLabTheme } from "../../ui/labTheme";
import { spacing } from "../tokens";
import { typography } from "../typography";
import { Surface } from "./Surface";

type Props = {
  label: string;
  meta?: string;
  value: string;
};

export function MetricCard({ label, meta, value }: Props) {
  const { colors } = useLabTheme<any>();
  return (
    <Surface rounded="md" variant="regular">
      <View style={{ gap: spacing.xs }}>
        <Text numberOfLines={1} style={[typography.monoXs, { color: colors.muted }]}>
          {label}
        </Text>
        <Text adjustsFontSizeToFit numberOfLines={1} style={[typography.displaySm, { color: colors.ink }]}>
          {value}
        </Text>
        {meta ? (
          <Text numberOfLines={2} style={[typography.bodyXs, { color: colors.quiet }]}>
            {meta}
          </Text>
        ) : null}
      </View>
    </Surface>
  );
}
