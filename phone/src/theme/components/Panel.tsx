import React from "react";
import { StyleProp, ViewStyle } from "react-native";
import { radius } from "../tokens";
import { GlassPanel2 } from "./GlassPanel2";
import { Surface } from "./Surface";

type Props = {
  children?: React.ReactNode;
  chrome?: "solid" | "glass";
  padded?: boolean;
  rounded?: keyof typeof radius;
  style?: StyleProp<ViewStyle>;
  variant?: "subtle" | "regular" | "strong";
};

export function Panel({
  children,
  chrome = "solid",
  padded = true,
  rounded = "md",
  style,
  variant = "regular",
}: Props) {
  if (chrome === "glass") {
    return (
      <GlassPanel2 rounded={rounded} style={style}>
        {children}
      </GlassPanel2>
    );
  }
  return (
    <Surface padded={padded} rounded={rounded} style={style} variant={variant}>
      {children}
    </Surface>
  );
}
