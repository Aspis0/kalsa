import React from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useLocale, type Locale } from "../i18n";
import { GlassPanel2, Header } from "../theme/components";
import { radius, spacing } from "../theme/tokens";
import { typography } from "../theme/typography";
import { useLabTheme } from "../ui/labTheme";

type Props = {
  onBack: () => void;
};

/**
 * Settings — full-screen View overlay opened from the drawer.
 * Not a Modal: Android hardware back is handled in AppShell.
 */
export function SettingsScreen({ onBack }: Props) {
  const { colors } = useLabTheme<any>();
  const insets = useSafeAreaInsets();
  const { locale, setLocale, t } = useLocale();

  const options: Array<{ id: Locale; label: string }> = [
    { id: "en", label: t("settings.languageEn") },
    { id: "it", label: t("settings.languageIt") },
  ];

  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        backgroundColor: colors.shell,
        zIndex: 50,
      }}
    >
      <Header title={t("settings.title")} onBack={onBack} />
      <View
        style={{
          flex: 1,
          padding: spacing.lg,
          paddingBottom: insets.bottom + spacing.lg,
          gap: spacing.md,
        }}
      >
        <GlassPanel2 rounded="lg" style={{ padding: spacing.lg, gap: spacing.sm }}>
          <Text style={[typography.bodySm, { color: colors.ink, fontWeight: "600" }]}>
            {t("settings.language")}
          </Text>
          <Text style={[typography.bodyXs, { color: colors.muted, marginBottom: spacing.xs }]}>
            {t("settings.languageHint")}
          </Text>
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            {options.map((option) => {
              const selected = locale === option.id;
              return (
                <Pressable
                  key={option.id}
                  onPress={() => setLocale(option.id)}
                  style={{
                    flex: 1,
                    paddingVertical: spacing.sm,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: selected ? colors.accent : colors.line,
                    backgroundColor: selected ? `${colors.accent}22` : "transparent",
                    alignItems: "center",
                  }}
                >
                  <Text
                    style={[
                      typography.bodySm,
                      {
                        color: selected ? colors.accent : colors.ink,
                        fontWeight: selected ? "700" : "500",
                      },
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </GlassPanel2>

        <GlassPanel2 rounded="lg" style={{ padding: spacing.lg }}>
          <Text style={[typography.bodyMd, { color: colors.muted }]}>
            {t("settings.placeholder")}
          </Text>
        </GlassPanel2>
      </View>
    </View>
  );
}
