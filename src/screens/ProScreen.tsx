import { useCallback, useEffect, useState } from "react";
import { BackHandler, Pressable, ScrollView, Text, View } from "react-native";
import { Cpu, FileText, Focus, Sparkles } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocale, type TranslationKey } from "../i18n";
import { e1, modes, radius, space, type, type ThemeMode } from "../theme/design";
import { useLabTheme } from "../ui/labTheme";
import { SettingsHeader } from "./SettingsHeader";

type Props = { onBack: () => void };
const BENEFITS: Array<{ Icon: typeof Sparkles; key: TranslationKey }> = [
  { Icon: Sparkles, key: "account.proBenefit1" },
  { Icon: Cpu, key: "account.proBenefit2" },
  { Icon: FileText, key: "account.proBenefit3" },
  { Icon: Focus, key: "account.proBenefit4" },
];
type ThemeContext = { mode: ThemeMode };

/** Pro — upgrade information opened from Account. */
export function ProScreen({ onBack }: Props) {
  const { mode } = useLabTheme<ThemeContext>();
  const colors = modes[mode];
  const insets = useSafeAreaInsets();
  const { t } = useLocale();
  const [feedback, setFeedback] = useState(false);
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
      <SettingsHeader title={t("account.proTitle")} onBack={handleBack} backLabel={t("common.back")} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: space.md, paddingTop: space.xs, paddingBottom: insets.bottom + space.lg, gap: space.md, flexGrow: 1 }}>
        <View style={[cardStyle, { paddingVertical: space.xl }]}>
          <Text style={[type.display, { color: colors.ink }]}>{t("account.proHero")}</Text>
        </View>
        <View style={[cardStyle, { paddingVertical: space.xs }]}>
          {BENEFITS.map(({ Icon, key }, index) => (
            <View key={key} style={{ minHeight: 56, flexDirection: "row", alignItems: "center", gap: space.md }}>
              <Icon size={20} color={colors.accent} strokeWidth={1.75} />
              <Text style={[type.body, { color: colors.ink, flex: 1 }]}>{t(key)}</Text>
              {index < BENEFITS.length - 1 ? <View style={{ position: "absolute", left: space.xl + space.sm, right: 0, bottom: 0, height: 1, backgroundColor: colors.line }} /> : null}
            </View>
          ))}
        </View>
        <View style={cardStyle}>
          <Text style={[type.title, { color: colors.ink }]}>{t("account.proPrice", { price: t("account.proPriceValue") })}</Text>
          <Text style={[type.secondary, { color: colors.ink2 }]}>{t("account.proBilledMonthly")}</Text>
          <Pressable
            onPress={() => setFeedback(true)}
            accessibilityRole="button"
            accessibilityLabel={t("account.proCta")}
            style={({ pressed }) => ({ minHeight: 52, alignItems: "center", justifyContent: "center", borderRadius: radius.button, backgroundColor: pressed ? colors.brandDeep : colors.brand })}
          >
            <Text style={[type.bodyStrong, { color: colors.onBrand }]}>{t("account.proCta")}</Text>
          </Pressable>
          <Text style={[type.secondary, { color: colors.ink3, textAlign: "center" }]}>{t("account.proCancelAnytime")}</Text>
          {feedback ? <Text style={[type.secondary, { color: colors.accent }]} accessibilityLiveRegion="polite">{t("account.proComingSoon")}</Text> : null}
        </View>
      </ScrollView>
    </View>
  );
}
