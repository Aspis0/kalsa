import React from "react";
import { Pressable, Text, View } from "react-native";
import { Menu, ChevronLeft } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLabTheme } from "../../ui/labTheme";
import { spacing } from "../tokens";
import { typography } from "../typography";

type Props = {
  title: string;
  subtitle?: string;
  onMenu?: () => void;
  onBack?: () => void;
  /** a11y label for the back chevron; defaults to "Back". */
  backAccessibilityLabel?: string;
  trailing?: React.ReactNode;
  transparent?: boolean;
};

// Top bar for screens. Three slots:
//   leading: hamburger (onMenu) or back chevron (onBack); takes priority back > menu.
//   title:   Plus Jakarta Sans display.md, with optional subtitle below in muted bodyXs.
//   trailing: free slot (AskAIChip, action icons).
// Sticky (caller positions it at top); transparent=true skips background for
// pages that want the painterly wash to read straight through.
export function Header({
  title,
  subtitle,
  onMenu,
  onBack,
  backAccessibilityLabel = "Back",
  trailing,
  transparent = false,
}: Props) {
  const { colors } = useLabTheme<any>();
  const insets = useSafeAreaInsets();

  const leading = onBack ? (
    <Pressable
      onPress={onBack}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={backAccessibilityLabel}
      style={{ padding: 6 }}
    >
      <ChevronLeft color={colors.ink} size={22} />
    </Pressable>
  ) : onMenu ? (
    <Pressable onPress={onMenu} hitSlop={10} style={{ padding: 6 }}>
      <Menu color={colors.ink} size={22} />
    </Pressable>
  ) : (
    <View style={{ width: 34 }} />
  );

  return (
    <View
      style={{
        paddingTop: insets.top + spacing.xs,
        paddingBottom: spacing.sm,
        paddingHorizontal: spacing.md,
        backgroundColor: transparent ? "transparent" : colors.shell,
        borderBottomWidth: transparent ? 0 : 1,
        borderBottomColor: colors.line,
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.sm,
      }}
    >
      {leading}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[typography.displayMd, { color: colors.ink }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[typography.bodyXs, { color: colors.muted, marginTop: 2 }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
    </View>
  );
}
