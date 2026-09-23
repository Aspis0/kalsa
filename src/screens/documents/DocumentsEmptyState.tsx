import { FileText, Plus } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import { useLocale } from "../../i18n";
import { modes, radius, space, type, type ThemeMode } from "../../theme/design";
import { useLabTheme } from "../../ui/labTheme";

type Props = {
  onAdd: () => void;
  disabled?: boolean;
};
type ThemeContext = { mode: ThemeMode };

export function DocumentsEmptyState({ onAdd, disabled }: Props) {
  const { mode } = useLabTheme<ThemeContext>();
  const colors = modes[mode];
  const { t } = useLocale();

  return (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        paddingHorizontal: space.md,
        paddingBottom: space.lg,
        gap: space.md,
      }}
    >
      <View
        style={{
          flexShrink: 0,
          backgroundColor: colors.surface,
          borderRadius: radius.card,
          padding: space.lg,
          alignItems: "center",
          gap: space.sm,
        }}
      >
        <FileText size={24} color={colors.accent} strokeWidth={1.75} />
        <Text
          style={[type.headline, { color: colors.ink, textAlign: "center" }]}
          accessibilityRole="header"
        >
          {t("documents.emptyTitle")}
        </Text>
        <Text style={[type.body, { color: colors.ink2, textAlign: "center" }]}>
          {t("documents.emptyBody")}
        </Text>
      </View>
      <Pressable
        onPress={onAdd}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={t("documents.add")}
        accessibilityState={{ disabled }}
        style={({ pressed }) => ({
          minHeight: 52,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: space.sm,
          borderRadius: radius.button,
          backgroundColor: disabled
            ? colors.tint
            : pressed ? colors.brandDeep : colors.brand,
          opacity: disabled ? 0.55 : 1,
        })}
      >
        <Plus size={20} color={disabled ? colors.ink3 : colors.onBrand} strokeWidth={1.75} />
        <Text style={[type.bodyStrong, { color: disabled ? colors.ink3 : colors.onBrand }]}>
          {t("documents.add")}
        </Text>
      </Pressable>
    </View>
  );
}
