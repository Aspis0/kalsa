import React from "react";
import { Pressable, Text, View, ViewStyle, StyleProp } from "react-native";
import { useLabTheme } from "../../ui/labTheme";
import { radius, shadows, spacing } from "../tokens";
import { typography } from "../typography";

type Variant = "primary" | "ghost" | "destructive" | "compute";
type Size = "sm" | "md" | "lg";

type Props = {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  size?: Size;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
};

const padBySize: Record<Size, { h: number; v: number; fontSize: number }> = {
  sm: { h: spacing.sm, v: 6, fontSize: 13 },
  md: { h: spacing.md, v: 10, fontSize: 14 },
  lg: { h: spacing.lg, v: 14, fontSize: 16 },
};

export function Button({
  label,
  onPress,
  variant = "primary",
  size = "md",
  leadingIcon,
  trailingIcon,
  disabled = false,
  fullWidth = false,
  style,
}: Props) {
  const { colors } = useLabTheme<any>();
  const pad = padBySize[size];

  let bg: string;
  let text: string;
  let border: string | undefined;
  let extra: ViewStyle = {};
  switch (variant) {
    case "primary":
      bg = colors.accent;
      text = colors.primaryText;
      border = "transparent";
      extra = shadows.accent;
      break;
    case "destructive":
      bg = colors.bad;
      text = "#ffffff";
      border = "transparent";
      break;
    case "compute":
      bg = colors.compute;
      text = colors.primaryText;
      border = "transparent";
      break;
    case "ghost":
    default:
      bg = "transparent";
      text = colors.accent;
      border = colors.lineStrong;
  }

  if (disabled) {
    bg = colors.panelBright;
    text = colors.muted;
    border = colors.line;
    extra = {};
  }

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [
        {
          backgroundColor: bg,
          borderRadius: radius.md,
          borderWidth: variant === "ghost" ? 1 : 0,
          borderColor: border,
          paddingHorizontal: pad.h,
          paddingVertical: pad.v,
          opacity: pressed && !disabled ? 0.85 : 1,
          alignSelf: fullWidth ? "stretch" : "flex-start",
          ...extra,
        },
        style,
      ]}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
        }}
      >
        {leadingIcon}
        <Text
          style={[
            typography.bodyMd,
            { color: text, fontSize: pad.fontSize, fontFamily: typography.bodySm.fontFamily },
          ]}
        >
          {label}
        </Text>
        {trailingIcon}
      </View>
    </Pressable>
  );
}
