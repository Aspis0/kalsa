import React from "react";
import { Pressable, Text, View } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { useLabTheme } from "../../ui/labTheme";
import { radius, spacing } from "../tokens";
import { typography } from "../typography";

type Props = {
  leadingIcon: React.ReactNode;
  title: string;
  subtitle?: string;
  timestamp: string;
  tone?: "neutral" | "accent" | "teal" | "amber";
  onPress?: () => void;
};

const toneToColor: Record<NonNullable<Props["tone"]>, string> = {
  neutral: "muted",
  accent: "accent",
  teal: "compute",
  amber: "amber",
};

export function RecentCard({
  leadingIcon,
  title,
  subtitle,
  timestamp,
  tone = "neutral",
  onPress,
}: Props) {
  const { colors } = useLabTheme<any>();
  const iconColor = colors[toneToColor[tone]];

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.md,
        gap: spacing.md,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: radius.md,
          backgroundColor: `${iconColor}1A`,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {React.isValidElement(leadingIcon)
          ? React.cloneElement(leadingIcon as React.ReactElement<any>, { color: iconColor, size: 18 })
          : leadingIcon}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[typography.bodySm, { color: colors.ink }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[typography.bodyXs, { color: colors.muted, marginTop: 2 }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Text style={[typography.monoXs, { color: colors.muted }]}>{timestamp}</Text>
      <ChevronRight color={colors.muted} size={16} />
    </Pressable>
  );
}
