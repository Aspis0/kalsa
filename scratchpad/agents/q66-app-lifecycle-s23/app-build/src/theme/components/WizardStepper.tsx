import React from "react";
import { Pressable, Text, View } from "react-native";
import { Check } from "lucide-react-native";
import { useLabTheme } from "../../ui/labTheme";
import { radius, spacing } from "../tokens";
import { typography } from "../typography";

type Step = { id: string; label: string };

type Props = {
  steps: Step[];
  activeIndex: number;
  onSelect?: (index: number) => void;
};

export function WizardStepper({ steps, activeIndex, onSelect }: Props) {
  const { colors } = useLabTheme<any>();

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        gap: spacing.xs,
        borderBottomWidth: 1,
        borderBottomColor: colors.line,
      }}
    >
      {steps.map((step, i) => {
        const isActive = i === activeIndex;
        const isDone = i < activeIndex;
        const isFuture = i > activeIndex;
        const tappable = (isDone || isActive) && Boolean(onSelect);

        const bg = isActive
          ? colors.accent
          : isDone
          ? `${colors.accent}1f`
          : colors.panelBright;
        const fg = isActive
          ? colors.primaryText
          : isDone
          ? colors.accent
          : colors.muted;
        const border = isActive
          ? "transparent"
          : isDone
          ? `${colors.accent}55`
          : colors.line;

        return (
          <Pressable
            key={step.id}
            disabled={!tappable}
            onPress={() => tappable && onSelect?.(i)}
            style={({ pressed }) => ({
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              paddingHorizontal: spacing.sm,
              paddingVertical: 8,
              borderRadius: radius.pill,
              backgroundColor: bg,
              borderWidth: 1,
              borderColor: border,
              opacity: pressed && tappable ? 0.85 : 1,
            })}
          >
            {isDone ? (
              <Check color={fg} size={12} strokeWidth={2.4} />
            ) : (
              <Text
                style={[
                  typography.monoXs,
                  {
                    color: fg,
                    fontSize: 10,
                    opacity: isFuture ? 0.7 : 1,
                  },
                ]}
              >
                {String(i + 1)}
              </Text>
            )}
            <Text
              numberOfLines={1}
              style={[
                typography.bodyXs,
                {
                  color: fg,
                  fontSize: 11,
                  fontFamily: typography.bodySm.fontFamily,
                  opacity: isFuture ? 0.85 : 1,
                },
              ]}
            >
              {step.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
