import React from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FlaskConical, Sparkles, Globe, UserCircle } from "lucide-react-native";
import { useLabTheme } from "../../ui/labTheme";
import { spacing } from "../tokens";
import { typography } from "../typography";
import { GlassPanel2 } from "./GlassPanel2";
import { FAB } from "./FAB";

export type AgoraTabId = "bench" | "ai" | "omics" | "account";

type Props = {
  active: AgoraTabId;
  onChange: (id: AgoraTabId) => void;
  onFabPress: () => void;
  onFabLongPress: () => void;
};

const TABS: Array<{ id: AgoraTabId; label: string; Icon: any }> = [
  { id: "bench",   label: "Chat",   Icon: FlaskConical },
  { id: "ai",      label: "AI",     Icon: Sparkles },
  { id: "omics",   label: "Search", Icon: Globe },
  { id: "account", label: "Account", Icon: UserCircle },
];

export function TabBar({ active, onChange, onFabPress, onFabLongPress }: Props) {
  const { colors } = useLabTheme<any>();
  const insets = useSafeAreaInsets();

  // Render 4 tabs in two pairs with a center gap reserved for the FAB.
  // The FAB sits absolutely at the center, translated upward to overhang.
  const left = TABS.slice(0, 2);
  const right = TABS.slice(2, 4);

  const renderTab = (tab: (typeof TABS)[number]) => {
    const isActive = tab.id === active;
    const tint = isActive ? colors.accent : colors.muted;
    return (
      <Pressable
        key={tab.id}
        accessibilityRole="tab"
        accessibilityState={{ selected: isActive }}
        onPress={() => onChange(tab.id)}
        style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 6, gap: 2 }}
      >
        {isActive ? (
          <View
            style={{
              position: "absolute",
              top: 0,
              width: 28,
              height: 3,
              borderRadius: 2,
              backgroundColor: colors.accent,
            }}
          />
        ) : null}
        <tab.Icon color={tint} size={20} />
        <Text style={[typography.bodyXs, { color: tint, fontSize: 10, letterSpacing: 0.6 }]}>{tab.label}</Text>
      </Pressable>
    );
  };

  return (
    <View
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        paddingHorizontal: spacing.sm,
        paddingBottom: insets.bottom > 0 ? insets.bottom : spacing.sm,
        paddingTop: spacing.xs,
      }}
    >
      <GlassPanel2 rounded="xl" style={{ overflow: "visible" }}>
        <View style={{ flexDirection: "row", height: 60, alignItems: "center" }}>
          {left.map(renderTab)}
          <View style={{ width: 72 }} />
          {right.map(renderTab)}
        </View>
      </GlassPanel2>
      <View
        pointerEvents="box-none"
        style={{
          position: "absolute",
          top: -22,
          left: 0,
          right: 0,
          alignItems: "center",
        }}
      >
        <FAB onPress={onFabPress} onLongPress={onFabLongPress} />
      </View>
    </View>
  );
}
