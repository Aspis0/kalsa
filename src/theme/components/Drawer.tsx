import React, { useEffect, useRef } from "react";
import { Animated, Easing, Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLabTheme } from "../../ui/labTheme";
import { radius, spacing } from "../tokens";
import { typography } from "../typography";
import { GlassPanel2 } from "./GlassPanel2";

const DRAWER_WIDTH = 280;
const DURATION = 220;

export type DrawerItem = {
  id: string;
  label: string;
  Icon: React.ComponentType<any>;
  lastUsed?: string;
  onPress: () => void;
};

type Props = {
  open: boolean;
  onClose: () => void;
  brand?: string;
  subtitle?: string;
  items: DrawerItem[];
};

// Side drawer that slides from the left. The Modal stays mounted while
// animating closed so the slide-out is visible (open prop drives anim).
export function Drawer({ open, onClose, brand = "Kalsa", subtitle, items }: Props) {
  const { colors } = useLabTheme<any>();
  const insets = useSafeAreaInsets();
  const translateX = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = React.useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      Animated.parallel([
        Animated.timing(translateX, { toValue: 0, duration: DURATION, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: DURATION, useNativeDriver: true }),
      ]).start();
    } else if (mounted) {
      Animated.parallel([
        Animated.timing(translateX, { toValue: -DRAWER_WIDTH, duration: DURATION, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: DURATION, useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [open]);

  if (!mounted) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={{ flex: 1, opacity }}>
        <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)" }} />
        <Animated.View
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            width: DRAWER_WIDTH,
            transform: [{ translateX }],
          }}
        >
          <GlassPanel2 rounded="lg" style={{ flex: 1, borderRadius: 0, paddingTop: insets.top, paddingBottom: insets.bottom }}>
            <View style={{ padding: spacing.lg, paddingBottom: spacing.md }}>
              <Text style={[typography.displayMd, { color: colors.ink }]}>{brand}</Text>
              {subtitle ? (
                <Text style={[typography.bodyXs, { color: colors.muted, marginTop: 4 }]}>{subtitle}</Text>
              ) : null}
            </View>
            <View style={{ height: 1, backgroundColor: colors.line, marginHorizontal: spacing.md }} />
            <View style={{ paddingHorizontal: spacing.sm, paddingVertical: spacing.sm }}>
              <Text style={[typography.bodyXs, { color: colors.muted, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs }]}>
                Tools
              </Text>
              {items.map(({ id, label, Icon, lastUsed, onPress }) => (
                <Pressable
                  key={id}
                  onPress={() => {
                    onPress();
                    onClose();
                  }}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: spacing.md,
                    paddingHorizontal: spacing.sm,
                    paddingVertical: 10,
                    borderRadius: radius.sm,
                    backgroundColor: pressed ? colors.panel : "transparent",
                  })}
                >
                  <View
                    style={{
                      width: 28, height: 28, borderRadius: radius.sm,
                      backgroundColor: `${colors.accent}1A`,
                      alignItems: "center", justifyContent: "center",
                    }}
                  >
                    <Icon color={colors.accent} size={16} />
                  </View>
                  <Text style={[typography.bodyMd, { color: colors.ink, flex: 1, fontFamily: typography.bodySm.fontFamily }]}>
                    {label}
                  </Text>
                  {lastUsed ? (
                    <Text style={[typography.monoXs, { color: colors.muted }]}>{lastUsed}</Text>
                  ) : null}
                </Pressable>
              ))}
            </View>
          </GlassPanel2>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}
