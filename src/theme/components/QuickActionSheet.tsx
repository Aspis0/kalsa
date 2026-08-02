import React from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Camera, FileText, Beaker, History } from "lucide-react-native";
import { useLabTheme } from "../../ui/labTheme";
import { radius, spacing } from "../tokens";
import { typography } from "../typography";
import { GlassPanel2 } from "./GlassPanel2";

export type QuickAction = "chat" | "search" | "miniapp" | "openLast";

type Props = {
  visible: boolean;
  onClose: () => void;
  onAction: (action: QuickAction) => void;
};

const ACTIONS: Array<{ id: QuickAction; label: string; sub: string; Icon: any }> = [
  { id: "chat",     label: "New chat",      sub: "Start a conversation",            Icon: FileText },
  { id: "search",   label: "Web search",    sub: "Ask the web for an answer",       Icon: Camera },
  { id: "miniapp",  label: "New miniapp",   sub: "Generate an interactive block",   Icon: Beaker },
  { id: "openLast", label: "Open last item", sub: "Jump back to your most recent",  Icon: History },
];

// Bottom sheet triggered by long-press on the FAB.
export function QuickActionSheet({ visible, onClose, onAction }: Props) {
  const { colors } = useLabTheme<any>();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.42)", justifyContent: "flex-end" }}>
        <Pressable onPress={() => {}} style={{ padding: spacing.md, paddingBottom: insets.bottom + spacing.md }}>
          <GlassPanel2 rounded="lg">
            <View style={{ padding: spacing.md, gap: spacing.xs }}>
              <Text style={[typography.bodyXs, { color: colors.muted, marginBottom: spacing.xs }]}>Quick actions</Text>
              {ACTIONS.map(({ id, label, sub, Icon }) => (
                <Pressable
                  key={id}
                  onPress={() => {
                    onAction(id);
                    onClose();
                  }}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: spacing.md,
                    paddingVertical: spacing.sm,
                    paddingHorizontal: spacing.sm,
                    borderRadius: radius.md,
                    backgroundColor: pressed ? colors.panel : "transparent",
                  })}
                >
                  <View
                    style={{
                      width: 36, height: 36, borderRadius: radius.md,
                      backgroundColor: `${colors.accent}22`,
                      alignItems: "center", justifyContent: "center",
                    }}
                  >
                    <Icon color={colors.accent} size={18} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[typography.bodyMd, { color: colors.ink, fontFamily: typography.bodySm.fontFamily }]}>
                      {label}
                    </Text>
                    <Text style={[typography.bodyXs, { color: colors.muted, marginTop: 2, letterSpacing: 0.4, textTransform: "none" }]}>
                      {sub}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          </GlassPanel2>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
