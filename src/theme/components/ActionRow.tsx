import React from "react";
import { Pressable, StyleProp, Text, View, ViewStyle } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { useLabTheme } from "../../ui/labTheme";
import { spacing } from "../tokens";
import { typography } from "../typography";
import { Surface } from "./Surface";

type Props = {
  disabled?: boolean;
  leading?: React.ReactNode;
  onPress?: () => void;
  subtitle?: string;
  style?: StyleProp<ViewStyle>;
  title: string;
  trailing?: React.ReactNode;
};

export function ActionRow({
  disabled = false,
  leading,
  onPress,
  subtitle,
  style,
  title,
  trailing,
}: Props) {
  const { colors } = useLabTheme<any>();
  return (
    <Pressable disabled={disabled || !onPress} onPress={onPress}>
      {({ pressed }) => (
        <Surface
          padded={false}
          rounded="md"
          style={[
            {
              opacity: disabled ? 0.55 : pressed ? 0.85 : 1,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
            },
            style,
          ]}
          variant="subtle"
        >
          <View style={{ alignItems: "center", flexDirection: "row", gap: spacing.sm }}>
            {leading ? <View>{leading}</View> : null}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={[typography.bodyMd, { color: colors.ink }]}>
                {title}
              </Text>
              {subtitle ? (
                <Text numberOfLines={2} style={[typography.bodyXs, { color: colors.muted, marginTop: 2 }]}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
            {trailing ?? (onPress ? <ChevronRight color={colors.muted} size={18} /> : null)}
          </View>
        </Surface>
      )}
    </Pressable>
  );
}
