import { useCallback, useEffect } from "react";
import { BackHandler, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocale } from "../i18n";
import { e1, modes, radius, space, type, type ThemeMode } from "../theme/design";
import { useLabTheme } from "../ui/labTheme";
import { SettingsHeader } from "./SettingsHeader";

type Props = { onBack: () => void };
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

const SECTIONS: Section[] = [
  { titleKey: "help.howItWorks.title", bodyKey: "help.howItWorks.body" },
  { titleKey: "help.models.title", bodyKey: "help.models.body" },
  { titleKey: "help.websearch.title", bodyKey: "help.websearch.body" },
  { titleKey: "help.privacy.title", bodyKey: "help.privacy.body" },
  { titleKey: "help.miniapps.title", bodyKey: "help.miniapps.body" },
  { titleKey: "help.limits.title", bodyKey: "help.limits.body" },
];
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

type ThemeContext = { mode: ThemeMode };

/** Help — informational overlay opened from Settings. */
export function HelpScreen({ onBack }: Props) {
  const { mode } = useLabTheme<ThemeContext>();
  const colors = modes[mode];
  const insets = useSafeAreaInsets();
  const { t } = useLocale();
  const handleBack = useCallback(() => onBack(), [onBack]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      handleBack();
      return true;
    });
    return () => sub.remove();
  }, [handleBack]);

  const cardStyle = {
    flexGrow: 0,
    flexShrink: 0,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: space.md,
    gap: space.sm,
    ...e1,
  } as const;

  return (
    <View style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.page, zIndex: 50 }}>
      <SettingsHeader title={t("help.title")} onBack={handleBack} backLabel={t("common.back")} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: space.md, paddingTop: space.xs, paddingBottom: insets.bottom + space.lg, gap: space.md, flexGrow: 1 }}>
        <View style={cardStyle}>
          <Text style={[type.body, { color: colors.ink2 }]}>{t("help.intro")}</Text>
        </View>
        {SECTIONS.map((section) => (
          <View key={section.titleKey} style={cardStyle}>
            <Text style={[type.headline, { color: colors.ink }]}>{t(section.titleKey)}</Text>
            <Text style={[type.body, { color: colors.ink2 }]}>{t(section.bodyKey)}</Text>
            {section.titleKey === "help.privacy.title" ? (
              <Text style={[type.body, { color: colors.ink2 }]}>{t("help.privacy.voice")}</Text>
            ) : null}
          </View>
        ))}
        <View style={cardStyle}>
          <Text style={[type.headline, { color: colors.ink }]}>{t("help.faq.title")}</Text>
          {FAQ_ITEMS.map((item) => (
            <View key={item.qKey} style={{ gap: space.xs, paddingVertical: space.xs }}>
              <Text style={[type.bodyStrong, { color: colors.ink }]}>{t(item.qKey)}</Text>
              <Text style={[type.body, { color: colors.ink2 }]}>{t(item.aKey)}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
