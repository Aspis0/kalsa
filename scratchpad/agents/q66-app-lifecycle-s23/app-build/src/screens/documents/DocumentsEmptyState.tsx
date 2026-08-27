/**
 * Empty library state: Lucide FileText + friendly copy + single CTA.
 */

import React from "react";
import { Pressable, Text, View } from "react-native";
import { FileText, Plus } from "lucide-react-native";

import { useLocale } from "../../i18n";
import { spacing } from "../../theme/tokens";
import { useTypography, fontFamilies } from "../../theme/typography";
import { useLabTheme } from "../../ui/labTheme";

type Props = {
  onAdd: () => void;
  disabled?: boolean;
};

export function DocumentsEmptyState({ onAdd, disabled }: Props) {
  const { colors } = useLabTheme<any>();
  const typography = useTypography();
  const { t } = useLocale();

  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: spacing.xl,
        gap: spacing.md,
        minHeight: 320,
      }}
    >
      <View
        style={{
          width: 96,
          height: 96,
          borderRadius: 28,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.accentSoft ?? "rgba(240, 122, 63, 0.16)",
          opacity: 0.9,
        }}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <FileText size={64} color={colors.accent} style={{ opacity: 0.85 }} />
      </View>

      <Text
        style={[
          typography.bodyMd ?? typography.bodySm,
          {
            color: colors.ink,
            fontFamily: fontFamilies.bodySemi,
            fontSize: 18,
            textAlign: "center",
          },
        ]}
        accessibilityRole="header"
      >
        {t("documents.emptyTitle")}
      </Text>
      <Text
        style={[
          typography.bodySm,
          { color: colors.muted, textAlign: "center", lineHeight: 20 },
        ]}
      >
        {t("documents.emptyBody")}
      </Text>

      <Pressable
        onPress={onAdd}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={t("documents.add")}
        style={{
          marginTop: spacing.sm,
          minHeight: 48,
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.sm + 2,
          borderRadius: 14,
          backgroundColor: colors.accent,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <Plus size={18} color="#FFFFFF" />
        <Text
          style={[
            typography.bodySm,
            {
              color: "#FFFFFF",
              fontFamily: fontFamilies.bodySemi,
            },
          ]}
        >
          {t("documents.add")}
        </Text>
      </Pressable>
    </View>
  );
}
