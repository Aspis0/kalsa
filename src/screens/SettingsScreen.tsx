import React from "react";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GlassPanel2, Header } from "../theme/components";
import { spacing } from "../theme/tokens";
import { typography } from "../theme/typography";
import { useLabTheme } from "../ui/labTheme";

type Props = {
  onBack: () => void;
};

/**
 * Settings placeholder — full-screen View overlay opened from the drawer.
 * Not a Modal: Android hardware back is handled in AppShell.
 */
export function SettingsScreen({ onBack }: Props) {
  const { colors } = useLabTheme<any>();
  const insets = useSafeAreaInsets();

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
      <Header title="Settings" onBack={onBack} />
      <View
        style={{
          flex: 1,
          padding: spacing.lg,
          paddingBottom: insets.bottom + spacing.lg,
        }}
      >
        <GlassPanel2 rounded="lg" style={{ padding: spacing.lg }}>
          <Text style={[typography.bodyMd, { color: colors.muted }]}>
            Settings will be added here
          </Text>
        </GlassPanel2>
      </View>
    </View>
  );
}
