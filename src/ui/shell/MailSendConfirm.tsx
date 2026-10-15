/**
 * The phone's own confirm before a reply leaves (PHONE-CHAT-PROTOCOL §5):
 * the press a person makes here is the click the computer's send requires, so
 * this sheet shows the recipient, the subject and the text in full — the three
 * things that cannot be taken back afterwards.
 *
 * A presentational leaf, shaped like `EditMessageModal`: a fade over a
 * dismiss-anywhere backdrop, with Cancel and Send as real touch targets.
 */
import { Modal, Pressable, Text, View } from "react-native";

import { useLocale } from "../../i18n";
import { elevation, radius, spacing, type, type DesignColors } from "../../theme/design";
import { MIN_TOUCH_TARGET } from "./shellGeometry";

export type MailSendConfirmProps = {
  visible: boolean;
  colors: DesignColors;
  to: string;
  subject: string;
  body: string;
  onConfirm: () => void;
  onClose: () => void;
};

export function MailSendConfirm({
  visible,
  colors,
  to,
  subject,
  body,
  onConfirm,
  onClose,
}: MailSendConfirmProps) {
  const { t } = useLocale();
  if (!visible) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        testID="shell.mailConfirm.backdrop"
        accessibilityRole="button"
        accessibilityLabel={t("common.close")}
        onPress={onClose}
        style={styles.backdrop}
      >
        {/* The swallow: taps on dead space inside the card do nothing. */}
        <Pressable
          testID="shell.mailConfirm.card"
          accessibilityRole="none"
          accessibilityLabel={t("chat.mail.send")}
          onPress={() => undefined}
          style={[styles.card, { backgroundColor: colors.surface }]}
        >
          <Text style={[type.bodyStrong, { color: colors.ink }]}>
            {t("chat.mail.confirmSendTitle")}
          </Text>
          <Text style={[type.secondary, { color: colors.silence }]}>
            {`${t("chat.mail.to")}: ${to}`}
          </Text>
          {subject !== "" ? (
            <Text style={[type.secondary, { color: colors.silence }]}>
              {`${t("chat.mail.subject")}: ${subject}`}
            </Text>
          ) : null}
          <Text style={[type.body, { color: colors.ink }]} testID="shell.mailConfirm.body">
            {body}
          </Text>
          <Text style={[type.caption, { color: colors.silence }]}>
            {t("chat.mail.confirmSendBody")}
          </Text>
          <View style={styles.buttons}>
            <Pressable
              testID="shell.mailConfirm.cancel"
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
              testID="shell.mailConfirm.send"
              accessibilityRole="button"
              accessibilityLabel={t("chat.mail.send")}
              onPress={onConfirm}
              style={({ pressed }) => [
                styles.button,
                { backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Text style={[type.label, { color: colors.onAccent }]}>{t("chat.mail.send")}</Text>
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
    padding: spacing.lg,
  },
  card: {
    ...elevation.raised,
    gap: spacing.sm,
    borderRadius: radius.xl,
    padding: spacing.md,
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
} as const;