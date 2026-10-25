import React from "react";
import { Pressable, Text, View } from "react-native";
import { Sparkles } from "lucide-react-native";
import { useLabTheme } from "../../ui/labTheme";
import { radius, spacing } from "../tokens";
import { typography } from "../typography";

type Props = {
  onPress: () => void;
  label?: string;
};

// Compact chip rendered in Header trailing slot. Replaces the old
// "askAssistantButton" prop with a unified visual. Parent owns the sheet
// state and opens it via onPress; this component is just the trigger.
export function AskAIChip({ onPress, label = "Ask AI" }: Props) {
  const { colors } = useLabTheme<any>();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: spacing.sm,
        paddingVertical: 6,
        borderRadius: radius.pill,
        backgroundColor: `${colors.accent}22`,
        borderWidth: 1,
        borderColor: `${colors.accent}55`,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Sparkles color={colors.accent} size={14} />
      <Text style={[typography.bodyXs, { color: colors.accent, letterSpacing: 0.5 }]}>{label}</Text>
    </Pressable>
  );
}
