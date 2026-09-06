import React, { useMemo, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Calculator, Beaker, Camera, Compare, FileText, History, HelpCircle } from "lucide-react-native";
import { useLocale } from "../../i18n";
import { useLabTheme } from "../../ui/labTheme";
import { radius, spacing } from "../tokens";
import { typography } from "../typography";
import { GlassPanel2 } from "./GlassPanel2";
import { MINIAPP_TEMPLATES, type MiniappTemplate, type MiniappTemplateId } from "../../domain/miniappTemplates";

export type QuickAction = "chat" | "search" | "miniapp" | "openLast";

type Props = {
  visible: boolean;
  onClose: () => void;
  onAction: (action: QuickAction) => void;
  /** Fired when a miniapp template is chosen (prefills the chat with its prompt). */
  onChooseTemplate?: (template: MiniappTemplate) => void;
};

// Bottom sheet for quick actions (no longer tied to the FAB, which was removed).
export function QuickActionSheet({ visible, onClose, onAction }: Props) {
  const { colors } = useLabTheme<any>();
  const { t } = useLocale();
  const insets = useSafeAreaInsets();
  const [miniappOpen, setMiniappOpen] = useState(false);

  const templateIcon = (id: MiniappTemplateId) => {
    switch (id) {
      case "quick_calculator":
        return Calculator;
      case "reading_quiz":
        return HelpCircle;
      default:
        return Compare;
    }
  };

  const actions = useMemo(
    () =>
      [
        {
          id: "chat" as const,
          label: t("quickActions.newChat"),
          sub: t("quickActions.newChatSub"),
          Icon: FileText,
        },
        {
          id: "search" as const,
          label: t("quickActions.webSearch"),
          sub: t("quickActions.webSearchSub"),
          Icon: Camera,
        },
        {
          id: "miniapp" as const,
          label: t("quickActions.newMiniapp"),
          sub: t("quickActions.newMiniappSub"),
          Icon: Beaker,
          isMiniapp: true,
        },
        {
          id: "openLast" as const,
          label: t("quickActions.openLast"),
          sub: t("quickActions.openLastSub"),
          Icon: History,
        },
      ] satisfies Array<{ id: QuickAction; label: string; sub: string; Icon: any; isMiniapp?: boolean }>,
    [t],
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.42)", justifyContent: "flex-end" }}>
        <Pressable onPress={() => {}} style={{ padding: spacing.md, paddingBottom: insets.bottom + spacing.md }}>
          <GlassPanel2 rounded="lg">
            <View style={{ padding: spacing.md, gap: spacing.xs }}>
              <Text style={[typography.bodyXs, { color: colors.muted, marginBottom: spacing.xs }]}>
                {t("quickActions.title")}
              </Text>
              {actions.map(({ id, label, sub, Icon }) => {
                const isMiniappAction = id === "miniapp";
                const expanded = isMiniappAction && miniappOpen;
                return (
                  <View key={id}>
                    <Pressable
                      onPress={() => {
                        if (isMiniappAction) {
                          setMiniappOpen((open) => !open);
                          return;
                        }
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
                    {expanded && (
                      <View style={{ paddingLeft: spacing.xl, paddingTop: spacing.xs, gap: spacing.xs }}>
                        {MINIAPP_TEMPLATES.map((template) => {
                          const TemplateIcon = templateIcon(template.id);
                          return (
                            <Pressable
                              key={template.id}
                              onPress={() => {
                                onChooseTemplate?.(template);
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
                                  width: 32, height: 32, borderRadius: radius.md,
                                  backgroundColor: `${colors.accent}22`,
                                  alignItems: "center", justifyContent: "center",
                                }}
                              >
                                <TemplateIcon color={colors.accent} size={16} />
                              </View>
                              <View style={{ flex: 1 }}>
                                <Text style={[typography.bodySm, { color: colors.ink }]}>
                                  {t(template.labelKey)}
                                </Text>
                                <Text style={[typography.bodyXs, { color: colors.muted, marginTop: 2 }]}>
                                  {t(template.subKey)}
                                </Text>
                              </View>
                            </Pressable>
                          );
                        })}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          </GlassPanel2>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
