import { useCallback, useEffect } from "react";
import { BackHandler, ScrollView, Text, View } from "react-native";
import { Monitor, Search, ShieldCheck, Sparkles } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocale } from "../i18n";
import { e1, modes, radius, space, type, type ThemeMode } from "../theme/design";
import { useLabTheme } from "../ui/labTheme";
import { SettingsHeader } from "./SettingsHeader";

type Props = { onBack: () => void };
type ThemeContext = { mode: ThemeMode };

/** Pro — explains the upcoming offer without implying it can be purchased yet. */
export function ProScreen({ onBack }: Props) {
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
  const benefitStyle = { minHeight: 56, flexDirection: "row" as const, alignItems: "center" as const, gap: space.md };

  return (
    <View style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.page, zIndex: 50 }}>
      <SettingsHeader title={t("account.proTitle")} onBack={handleBack} backLabel={t("common.back")} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: space.md, paddingTop: space.xs, paddingBottom: insets.bottom + space.lg, gap: space.md, flexGrow: 1 }}>
        <View style={[cardStyle, { paddingVertical: space.xl }]}>
          <Text style={[type.display, { color: colors.ink }]}>{t("account.proHero")}</Text>
          <Text style={[type.body, { color: colors.ink2 }]}>{t("account.proAvailability")}</Text>
        </View>
        <View style={cardStyle}>
          <Text style={[type.title, { color: colors.ink }]}>{t("account.proUnlocksTitle")}</Text>
          <View style={benefitStyle}>
            <Monitor size={20} color={colors.accent} strokeWidth={1.75} />
            <Text style={[type.body, { color: colors.ink, flex: 1 }]}>{t("account.proComputerBenefit")}</Text>
          </View>
          <View style={benefitStyle}>
            <Search size={20} color={colors.accent} strokeWidth={1.75} />
            <Text style={[type.body, { color: colors.ink, flex: 1 }]}>{t("account.proSearchBenefit")}</Text>
          </View>
          <View testID="pro.benefit.future" style={benefitStyle}>
            <Sparkles size={20} color={colors.accent} strokeWidth={1.75} />
            <View style={{ flex: 1, gap: space.xs }}>
              <Text testID="pro.benefit.future.title" style={[type.bodyStrong, { color: colors.ink }]}>{t("account.proFutureTitle")}</Text>
              <Text testID="pro.benefit.future.detail" style={[type.secondary, { color: colors.ink2 }]}>{t("account.proFutureBenefit")}</Text>
            </View>
          </View>
        </View>
        <View style={cardStyle}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <ShieldCheck size={20} color={colors.accent} strokeWidth={1.75} />
            <Text style={[type.title, { color: colors.ink }]}>{t("account.proUnchangedTitle")}</Text>
          </View>
          <Text style={[type.body, { color: colors.ink2 }]}>{t("account.proUnchangedBody")}</Text>
        </View>
      </ScrollView>
    </View>
  );
}
