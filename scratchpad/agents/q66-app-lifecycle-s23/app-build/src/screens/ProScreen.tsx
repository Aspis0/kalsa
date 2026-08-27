import React, { useCallback, useEffect, useState } from "react";
import { BackHandler, ScrollView, Text, View } from "react-native";
import { FileText, Focus, Sparkles, Cpu } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useLocale, type TranslationKey } from "../i18n";
import { Button, GlassPanel2, Header } from "../theme/components";
import { spacing } from "../theme/tokens";
import { fontFamilies, useTypography } from "../theme/typography";
import { useLabTheme } from "../ui/labTheme";

type Props = {
  onBack: () => void;
};

const BENEFITS: Array<{
  Icon: typeof Sparkles;
  key: TranslationKey;
}> = [
  { Icon: Sparkles, key: "account.proBenefit1" },
  { Icon: Cpu, key: "account.proBenefit2" },
  { Icon: FileText, key: "account.proBenefit3" },
  { Icon: Focus, key: "account.proBenefit4" },
];

/**
 * Pro — UI-only upgrade overlay opened from Account.
 * Hardware back returns to Account (caller decides the target).
 */
export function ProScreen({ onBack }: Props) {
  const { colors } = useLabTheme<any>();
  const typography = useTypography();
  const insets = useSafeAreaInsets();
  const { t } = useLocale();
  const [feedback, setFeedback] = useState(false);

  const handleBack = useCallback(() => {
    onBack();
  }, [onBack]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      handleBack();
      return true;
    });
    return () => sub.remove();
  }, [handleBack]);

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
      <Header
        title={t("account.proTitle")}
        onBack={handleBack}
        backAccessibilityLabel={t("common.back")}
      />
      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: insets.bottom + spacing.lg,
          gap: spacing.md,
        }}
      >
        <GlassPanel2 opaque rounded="lg" style={{ padding: spacing.lg, gap: spacing.sm }}>
          <Text
            style={[
              typography.displayMd,
              { color: colors.ink, fontFamily: fontFamilies.displayBold },
            ]}
          >
            {t("account.proHero")}
          </Text>
        </GlassPanel2>

        <GlassPanel2 opaque rounded="lg" style={{ padding: spacing.lg, gap: spacing.md }}>
          {BENEFITS.map((row) => (
            <View
              key={row.key}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.sm,
                minHeight: 44,
              }}
            >
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: colors.accentSoft,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <row.Icon size={18} color={colors.accent} />
              </View>
              <Text style={[typography.bodyMd, { color: colors.ink, flex: 1 }]}>
                {t(row.key)}
              </Text>
            </View>
          ))}
        </GlassPanel2>

        <GlassPanel2 opaque rounded="lg" style={{ padding: spacing.lg, gap: spacing.sm }}>
          <Text
            style={[
              typography.displayLg,
              { color: colors.ink, fontFamily: fontFamilies.displayExtra },
            ]}
          >
            {t("account.proPrice", { price: t("account.proPriceValue") })}
          </Text>
          <Text style={[typography.bodyXs, { color: colors.muted }]}>
            {t("account.proBilledMonthly")}
          </Text>
          <Button
            label={t("account.proCta")}
            onPress={() => setFeedback(true)}
            fullWidth
            size="lg"
          />
          <Text
            style={[
              typography.bodyXs,
              { color: colors.quiet ?? colors.muted, textAlign: "center" },
            ]}
          >
            {t("account.proCancelAnytime")}
          </Text>
          {feedback ? (
            <Text
              style={[typography.bodySm, { color: colors.accent }]}
              accessibilityLiveRegion="polite"
            >
              {t("account.proComingSoon")}
            </Text>
          ) : null}
        </GlassPanel2>
      </ScrollView>
    </View>
  );
}
