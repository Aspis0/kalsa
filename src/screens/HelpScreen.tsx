import React, { useCallback, useEffect } from "react";
import { BackHandler, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useLocale } from "../i18n";
import { GlassPanel2, Header } from "../theme/components";
import { spacing } from "../theme/tokens";
import { typography } from "../theme/typography";
import { useLabTheme } from "../ui/labTheme";

type Props = {
  /** Back from Help returns to Settings (not the chat). */
  onBack: () => void;
};

type Section = {
  titleKey:
    | "help.howItWorks.title"
    | "help.models.title"
    | "help.websearch.title"
    | "help.privacy.title"
    | "help.miniapps.title"
    | "help.limits.title";
  bodyKey:
    | "help.howItWorks.body"
    | "help.models.body"
    | "help.websearch.body"
    | "help.privacy.body"
    | "help.miniapps.body"
    | "help.limits.body";
};

const SECTIONS: Section[] = [
  { titleKey: "help.howItWorks.title", bodyKey: "help.howItWorks.body" },
  { titleKey: "help.models.title", bodyKey: "help.models.body" },
  { titleKey: "help.websearch.title", bodyKey: "help.websearch.body" },
  { titleKey: "help.privacy.title", bodyKey: "help.privacy.body" },
  { titleKey: "help.miniapps.title", bodyKey: "help.miniapps.body" },
  { titleKey: "help.limits.title", bodyKey: "help.limits.body" },
];

type FaqItem = {
  qKey:
    | "help.faq.shortAnswers.q"
    | "help.faq.offline.q"
    | "help.faq.chatStorage.q"
    | "help.faq.language.q"
    | "help.faq.webSearchSent.q"
    | "help.faq.badApiKey.q"
    | "help.faq.modelDiff.q"
    | "help.faq.clearHistory.q"
    | "help.faq.sendImages.q";
  aKey:
    | "help.faq.shortAnswers.a"
    | "help.faq.offline.a"
    | "help.faq.chatStorage.a"
    | "help.faq.language.a"
    | "help.faq.webSearchSent.a"
    | "help.faq.badApiKey.a"
    | "help.faq.modelDiff.a"
    | "help.faq.clearHistory.a"
    | "help.faq.sendImages.a";
};

const FAQ_ITEMS: FaqItem[] = [
  { qKey: "help.faq.shortAnswers.q", aKey: "help.faq.shortAnswers.a" },
  { qKey: "help.faq.offline.q", aKey: "help.faq.offline.a" },
  { qKey: "help.faq.chatStorage.q", aKey: "help.faq.chatStorage.a" },
  { qKey: "help.faq.language.q", aKey: "help.faq.language.a" },
  { qKey: "help.faq.webSearchSent.q", aKey: "help.faq.webSearchSent.a" },
  { qKey: "help.faq.badApiKey.q", aKey: "help.faq.badApiKey.a" },
  { qKey: "help.faq.modelDiff.q", aKey: "help.faq.modelDiff.a" },
  { qKey: "help.faq.clearHistory.q", aKey: "help.faq.clearHistory.a" },
  { qKey: "help.faq.sendImages.q", aKey: "help.faq.sendImages.a" },
];

/**
 * Help — full-screen overlay opened from Settings.
 * Hardware back and header back both return to Settings (caller decides target).
 */
export function HelpScreen({ onBack }: Props) {
  const { colors } = useLabTheme<any>();
  const insets = useSafeAreaInsets();
  const { t } = useLocale();

  const handleBack = useCallback(() => {
    onBack();
  }, [onBack]);

  // Android hardware back: close Help (return to Settings). Consume event.
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
        title={t("help.title")}
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
        <GlassPanel2 rounded="lg" style={{ padding: spacing.lg, gap: spacing.sm }}>
          <Text style={[typography.bodySm, { color: colors.muted }]}>
            {t("help.intro")}
          </Text>
        </GlassPanel2>

        {SECTIONS.map((section) => (
          <GlassPanel2
            key={section.titleKey}
            rounded="lg"
            style={{ padding: spacing.lg, gap: spacing.sm }}
          >
            <Text style={[typography.bodySm, { color: colors.ink, fontWeight: "600" }]}>
              {t(section.titleKey)}
            </Text>
            <Text style={[typography.bodySm, { color: colors.muted }]}>
              {t(section.bodyKey)}
            </Text>
          </GlassPanel2>
        ))}

        <GlassPanel2 rounded="lg" style={{ padding: spacing.lg, gap: spacing.md }}>
          <Text style={[typography.bodySm, { color: colors.ink, fontWeight: "600" }]}>
            {t("help.faq.title")}
          </Text>
          {FAQ_ITEMS.map((item) => (
            <View key={item.qKey} style={{ gap: spacing.xs }}>
              <Text style={[typography.bodySm, { color: colors.ink, fontWeight: "600" }]}>
                {t(item.qKey)}
              </Text>
              <Text style={[typography.bodySm, { color: colors.muted }]}>
                {t(item.aKey)}
              </Text>
            </View>
          ))}
        </GlassPanel2>
      </ScrollView>
    </View>
  );
}
