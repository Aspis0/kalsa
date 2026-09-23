import { ActivityIndicator, Text, View } from "react-native";

import { useLocale } from "../../i18n";
import { e3, modes, radius, space, type, type ThemeMode } from "../../theme/design";
import { useLabTheme } from "../../ui/labTheme";

type Props = {
  fileName?: string | null;
};
type ThemeContext = { mode: ThemeMode };

function truncateName(name: string, max = 32): string {
  const chars = Array.from(name);
  if (chars.length <= max) return name;
  return `${chars.slice(0, max - 1).join("")}…`;
}

export function DocumentImportOverlay({ fileName }: Props) {
  const { mode } = useLabTheme<ThemeContext>();
  const colors = modes[mode];
  const { t } = useLocale();
  const label = fileName
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
        backgroundColor: "rgba(0,0,0,0.42)",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        paddingHorizontal: space.lg,
      }}
    >
      <View
        style={{
          width: "100%",
          maxWidth: 340,
          backgroundColor: colors.surface,
          borderRadius: radius.card,
          padding: space.lg,
          alignItems: "center",
          gap: space.md,
          ...e3,
        }}
      >
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={[type.bodyStrong, { color: colors.ink, textAlign: "center" }]}>
          {label}
        </Text>
      </View>
    </View>
  );
}
