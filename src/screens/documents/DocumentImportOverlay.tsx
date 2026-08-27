/**
 * Full-screen dim + GlassPanel2 card while a document is being imported.
 * Blocks interaction; shows friendly "Reading your document…" copy.
 */

import React from "react";
import { ActivityIndicator, Text, View } from "react-native";

import { useLocale } from "../../i18n";
import { GlassPanel2 } from "../../theme/components";
import { spacing } from "../../theme/tokens";
import { useTypography, fontFamilies } from "../../theme/typography";
import { useLabTheme } from "../../ui/labTheme";

type Props = {
  /** Optional filename shown truncated to 32 chars. */
  fileName?: string | null;
};

function truncateName(name: string, max = 32): string {
  const chars = Array.from(name);
  if (chars.length <= max) return name;
  return `${chars.slice(0, max - 1).join("")}…`;
}

export function DocumentImportOverlay({ fileName }: Props) {
  const { colors } = useLabTheme<any>();
  const typography = useTypography();
  const { t } = useLocale();

  const label =
    fileName && fileName.length > 0
      ? t("documents.readingName", { name: truncateName(fileName) })
      : t("documents.reading");

  return (
    <View
      pointerEvents="auto"
      accessibilityViewIsModal
      accessibilityLabel={label}
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        backgroundColor: "rgba(0,0,0,0.45)",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        paddingHorizontal: spacing.lg,
      }}
    >
      <GlassPanel2
        rounded="lg"
        opaque
        style={{
          width: "100%",
          maxWidth: 340,
          paddingVertical: spacing.xl,
          paddingHorizontal: spacing.lg,
          alignItems: "center",
          gap: spacing.md,
        }}
      >
        <ActivityIndicator size="large" color={colors.accent} />
        <Text
          style={[
            typography.bodySm,
            {
              color: colors.ink,
              fontFamily: fontFamilies.bodySemi,
              textAlign: "center",
            },
          ]}
        >
          {label}
        </Text>
      </GlassPanel2>
    </View>
  );
}
