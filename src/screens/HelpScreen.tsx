import { useCallback, useEffect } from "react";
import { BackHandler, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocale, type TranslationKey } from "../i18n";
import { e1, modes, radius, space, type, type ThemeMode } from "../theme/design";
import { useLabTheme } from "../ui/labTheme";
import { SettingsHeader } from "./SettingsHeader";

type Props = { onBack: () => void };
type Section = {
  id: string;
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
  noteKey?: TranslationKey;
};

const SECTIONS: readonly Section[] = [
  { id: "about", titleKey: "help.about.title", bodyKey: "help.about.body" },
  { id: "modelLocation", titleKey: "help.modelLocation.title", bodyKey: "help.modelLocation.body" },
  { id: "deviceData", titleKey: "help.deviceData.title", bodyKey: "help.deviceData.body" },
  { id: "computer", titleKey: "help.computer.title", bodyKey: "help.computer.body" },
  { id: "models", titleKey: "help.models.title", bodyKey: "help.models.body" },
  { id: "privacy", titleKey: "help.privacy.title", bodyKey: "help.privacy.body", noteKey: "help.privacy.voice" },
];

type ThemeContext = { mode: ThemeMode };

/** Help — six concise sections, opened from Settings. */
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
        {SECTIONS.map((section) => (
          <View key={section.id} testID={`help.section.${section.id}`} style={cardStyle}>
            <Text style={[type.headline, { color: colors.ink }]}>{t(section.titleKey)}</Text>
            <Text testID={`help.section.body.${section.id}`} style={[type.body, { color: colors.ink2 }]}>{t(section.bodyKey)}</Text>
            {section.noteKey ? <Text style={[type.body, { color: colors.ink2 }]}>{t(section.noteKey)}</Text> : null}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
