/**
 * Collapsed, expandable view of the reasoning a model emitted inside its
 * think block, shown above the answer the way desktop chat apps do.
 * Collapsed by default; one responsibility only (display) — persistence and
 * extraction live in the engine (thinkingText / thinkStream).
 */
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { ChevronDown } from "lucide-react-native";

import { spacing, radius } from "../theme/tokens";
import { typography } from "../theme/typography";
import type { TranslateFn } from "../i18n";

export function ReasoningBlock({
  text,
  colors,
  t,
}: {
  text: string;
  colors: {
    muted: string;
    ink: string;
    surfaceSunken: string;
    lineStrong: string;
  };
  t: TranslateFn;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View
      style={{
        backgroundColor: colors.surfaceSunken,
        borderWidth: 1,
        borderColor: colors.lineStrong,
        borderRadius: radius.sm,
        marginVertical: 4,
        overflow: "hidden",
      }}
    >
      <Pressable
        onPress={() => setExpanded((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={t("chat.reasoningLabel")}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.xs,
          paddingHorizontal: spacing.sm,
          paddingVertical: 4,
        }}
      >
        <Text style={[typography.bodyXs, { color: colors.muted, flex: 1 }]}>
          {t("chat.reasoningLabel")}
        </Text>
        <View style={{ transform: [{ rotate: expanded ? "180deg" : "0deg" }] }}>
          <ChevronDown size={14} color={colors.muted} />
        </View>
      </Pressable>
      {expanded ? (
        <Text
          style={[
            typography.bodyXs,
            {
              color: colors.muted,
              paddingHorizontal: spacing.sm,
              paddingBottom: spacing.sm,
            },
          ]}
        >
          {text}
        </Text>
      ) : null}
    </View>
  );
}
