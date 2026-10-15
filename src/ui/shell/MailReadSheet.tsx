/**
 * One mail opened from a card (PHONE-CHAT-PROTOCOL §4): the record's own words
 * and the computer's fence-free body, in a sheet a person reads and closes.
 *
 * ONE sheet for the whole conversation, mounted by the host beside the
 * transcript: a card is a row, and a sheet per row would stack N identical
 * modals while a mail is open. It carries no action of its own — everything it
 * shows came from the computer, and the only press it takes is the one that
 * leaves.
 */
import { Modal, Pressable, ScrollView, Text, View } from "react-native";

import { useLocale, type Locale } from "../../i18n";
import { humanContractFailure } from "../../engine/remote/phoneChatFailures";
import { senderLine } from "../../domain/mailPayload";
import { formatAddedDate } from "../../documents/DocumentLibrary";
import { elevation, modes, radius, spacing, type, type ThemeMode } from "../../theme/design";
import { MIN_TOUCH_TARGET } from "./shellGeometry";
import { useMailActions } from "./mailActions";

/** The record's wire date as the app dates things elsewhere. A stamp the
 *  platform cannot read draws nothing: a raw `2026-10-13T18:13:38Z` on the
 *  screen is worse than no date at all. */
function sentOn(iso: string, locale: Locale): string {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? formatAddedDate(ms, locale) : "";
}

export function MailReadSheet({
  mode,
  conversationId,
  bottomInset,
}: {
  mode: ThemeMode;
  conversationId: string | undefined;
  /** The host's safe-area bottom, so the sheet's last row clears the Android
   *  navigation bar. */
  bottomInset: number;
}) {
  const { t, locale } = useLocale();
  const mail = useMailActions();
  const state = mail?.openMail;
  // The read the host holds may still be the previous conversation's for one
  // render after a switch: its owner is checked here, not left to an effect.
  if (!mail || !state || state.status === "idle" || mail.openedFor !== conversationId) {
    return null;
  }
  const colors = modes[mode];
  const date = state.status === "ready" ? sentOn(state.mail.record.date, locale) : "";
  return (
    <Modal
      visible
      transparent
      animationType="slide"
      onRequestClose={mail.closeMail}
      testID="shell.mailRead.modal"
    >
      <View style={styles.backdrop}>
        <View
          testID="shell.mailRead.card"
          style={[
            styles.card,
            { backgroundColor: colors.surface, paddingBottom: spacing.lg + bottomInset },
          ]}
        >
          {state.status === "loading" ? (
            <Text style={[type.body, { color: colors.silence }]}>
              {t("chat.mail.reading")}
            </Text>
          ) : null}
          {state.status === "failed" ? (
            <Text
              style={[type.body, { color: colors.danger }]}
              testID="shell.mailRead.failed"
            >
              {humanContractFailure(state.errorCode, t)}
            </Text>
          ) : null}
          {state.status === "ready" ? (
            <>
              <Text style={[type.bodyStrong, { color: colors.ink }]}>
                {state.mail.record.subject}
              </Text>
              <Text style={[type.caption, { color: colors.silence }]}>
                {senderLine(state.mail.record.from)}
              </Text>
              {date !== "" ? (
                <Text style={[type.caption, { color: colors.silence }]} testID="shell.mailRead.date">
                  {date}
                </Text>
              ) : null}
              <ScrollView style={styles.body}>
                <View style={styles.fence}>
                  <Text style={[type.caption, { color: colors.silence }]}>
                    {t("chat.mail.mailOpening")}
                  </Text>
                </View>
                <Text style={[type.body, { color: colors.ink }]} testID="shell.mailRead.body">
                  {state.mail.body}
                </Text>
              </ScrollView>
            </>
          ) : null}
          <Pressable
            testID="shell.mailRead.close"
            accessibilityRole="button"
            accessibilityLabel={t("common.close")}
            onPress={mail.closeMail}
            style={({ pressed }) => [
              styles.close,
              { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Text style={[type.label, { color: colors.ink }]}>{t("common.close")}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = {
  backdrop: {
    flex: 1,
    justifyContent: "flex-end" as const,
    backgroundColor: "rgba(0,0,0,0.42)",
  },
  card: {
    ...elevation.raised,
    gap: spacing.xs,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    maxHeight: "85%",
  },
  body: { marginTop: spacing.sm },
  fence: {
    borderTopWidth: 1,
    borderTopColor: "rgba(127,127,127,0.35)",
    paddingTop: spacing.sm,
  },
  close: {
    minHeight: MIN_TOUCH_TARGET,
    alignItems: "center" as const,
    flexDirection: "row" as const,
    justifyContent: "center" as const,
    marginTop: spacing.md,
    borderWidth: 1,
    borderRadius: radius.md,
  },
} as const;