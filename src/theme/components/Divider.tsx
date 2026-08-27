import React from "react";
import { View, ViewStyle } from "react-native";
import { useLabTheme } from "../../ui/labTheme";

type Props = {
  inset?: number;
  strong?: boolean;
  style?: ViewStyle;
};

export function Divider({ inset = 0, strong = false, style }: Props) {
  const { colors } = useLabTheme<any>();
  return (
    <View
      style={[
        {
          height: 1,
          marginLeft: inset,
          backgroundColor: strong ? colors.lineStrong : colors.line,
        },
        style,
      ]}
    />
  );
}
