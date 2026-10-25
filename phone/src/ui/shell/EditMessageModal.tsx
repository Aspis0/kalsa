/**
 * The edit-then-resend modal (D1 row 17), as a presentational leaf: the
 * controller's modal (`AiChatPage.tsx:4500-4581`) — a fade over a
 * dismiss-anywhere backdrop, a title, a multiline field prefilled with the
 * message, Cancel and Save — wired to the host's edit state.
 *
 * Differences this project forces: Cancel and Save are real
 * `MIN_TOUCH_TARGET` boxes with testIDs (the controller's were padded text
 * with no testID), no `hitSlop` anywhere, and no `bumpForegroundIdle` on
 * keystrokes — the host never assigns that ref (idle-dispose is an open
 * lift, PARITY-STATUS 4.4), so calling it here would be a no-op with a
 * comment claiming otherwise.
 */
import { Pressable, Text, View, Modal, TextInput } from "react-native";

import { useLocale } from "../../i18n";
import { elevation, modes, radius, spacing, type, type ThemeMode } from "../../theme/design";
import { MIN_TOUCH_TARGET } from "./shellGeometry";

export type EditMessageModalProps = {
  visible: boolean;
  mode: ThemeMode;
  draft: string;
  onChange: (draft: string) => void;
  /** Save: guards, truncate, resend — the host closes it on success. */
  onSubmit: () => void;
  onClose: () => void;
};

export function EditMessageModal({
  visible,
  mode,
  draft,
  onChange,
  onSubmit,
  onClose,
}: EditMessageModalProps) {
  const { t } = useLocale();
  if (!visible) return null;
  const colors = modes[mode];
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      {/* The backdrop dismisses: the controller's outer Pressable. */}
      <Pressable
        testID="shell.editModal.backdrop"
        accessibilityRole="button"
        accessibilityLabel={t("common.close")}
        onPress={onClose}
        style={styles.backdrop}
      >
        {/* The swallow: taps on dead space inside the card do nothing. */}
        <Pressable
          testID="shell.editModal.card"
          accessibilityRole="none"
          accessibilityLabel={t("chat.edit")}
          onPress={() => undefined}
          style={[styles.card, { backgroundColor: colors.surface }]}
        >
          <Text style={[type.label, { color: colors.ink }]}>{t("chat.edit")}</Text>
          <TextInput
            testID="shell.editModal.field"
            value={draft}
            onChangeText={onChange}
            multiline
            autoFocus
            accessibilityRole="text"
            accessibilityLabel={t("chat.edit")}
            style={[styles.field, { borderColor: colors.border, color: colors.ink }]}
          />
          <View style={styles.buttons}>
            <Pressable
              testID="shell.editModal.cancel"
              accessibilityRole="button"
              accessibilityLabel={t("common.cancel")}
              onPress={onClose}
              style={({ pressed }) => [
                styles.button,
                { justifyContent: "flex-start", opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Text style={[type.label, { color: colors.silence }]}>{t("common.cancel")}</Text>
            </Pressable>
            <Pressable
              testID="shell.editModal.save"
              accessibilityRole="button"
              accessibilityLabel={t("common.save")}
              accessibilityState={{ disabled: !draft.trim() }}
              disabled={!draft.trim()}
              onPress={onSubmit}
              style={({ pressed }) => [
                styles.button,
                styles.save,
                { backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Text style={[type.label, { color: colors.onAccent }]}>{t("common.save")}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = {
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.42)",
    justifyContent: "center" as const,
    padding: spacing.md,
  },
  card: {
    borderRadius: radius.xl,
    ...elevation.raised,
    gap: spacing.sm,
    padding: spacing.md,
  },
  field: {
    minHeight: 96,
    maxHeight: 200,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.sm,
    textAlignVertical: "top" as const,
    ...type.label,
  },
  buttons: {
    flexDirection: "row" as const,
    justifyContent: "flex-end" as const,
    gap: spacing.sm,
  },
  button: {
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET,
    alignItems: "center" as const,
    flexDirection: "row" as const,
    justifyContent: "center" as const,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  save: {
    ...elevation.raised,
  },
} as const;
