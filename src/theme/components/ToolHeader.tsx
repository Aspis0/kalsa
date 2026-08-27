import React from "react";
import { Pressable, Text, View } from "react-native";
import { ChevronLeft } from "lucide-react-native";
import { useLabTheme } from "../../ui/labTheme";
import { spacing } from "../tokens";
import { typography } from "../typography";
import { AskAIChip } from "./AskAIChip";

type Props = {
  title: string;
  subtitle?: string;
  onBack: () => void;
  onAskAi?: () => void;
  trailing?: React.ReactNode;
};

// Slim header used by each Bench tool screen reached from the drawer.
// Sits inline at the top of the tool's render tree (unlike `Header` which
// expects to be the screen-level top bar with safe-area inset padding).
// Visual: back chevron + Plus Jakarta Sans title + AskAIChip trailing slot.
export function ToolHeader({ title, subtitle, onBack, onAskAi, trailing }: Props) {
  const { colors } = useLabTheme<any>();
  return (
    <View
      style={{
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.md,
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.sm,
        borderBottomWidth: 1,
        borderBottomColor: colors.line,
      }}
    >
      <Pressable onPress={onBack} hitSlop={10} style={{ padding: 4 }}>
        <ChevronLeft color={colors.ink} size={22} />
      </Pressable>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[typography.displayMd, { color: colors.ink }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[typography.bodyXs, { color: colors.muted, marginTop: 2 }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing ?? (onAskAi ? <AskAIChip onPress={onAskAi} /> : null)}
    </View>
  );
}
