/**
 * The reply draft the computer built, and the phone's own send.
 *
 * The recipient and the subject are the computer's and are shown, never
 * chosen; only the text can be edited here, and only the phone's confirm sends
 * it (PHONE-CHAT-PROTOCOL §5). After a send the card says who it went to —
 * the computer's own answer — and its button goes quiet: a draft id is spent
 * by one send.
 */
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { useLocale } from "../../i18n";
import { humanContractFailure } from "../../engine/remote/phoneChatFailures";
import type { MailDraft } from "../../domain/mailPayload";
import { elevation, radius, spacing, type, type DesignColors } from "../../theme/design";
import { MIN_TOUCH_TARGET } from "./shellGeometry";
import { useMailActions } from "./mailActions";
import { MailSendConfirm } from "./MailSendConfirm";

export function MailDraftCard({
  draft,
  colors,
}: {
  draft: MailDraft;
  colors: DesignColors;
}) {
  const { t } = useLocale();
  const mail = useMailActions();
  const [body, setBody] = useState(draft.body);
  const [confirming, setConfirming] = useState(false);
  const send = mail?.sends[draft.draftId];
  const busy = send?.status === "sending";
  const sent = send?.status === "sent";
  // A blank edit is not a draft: the computer would fall back to the words it
  // wrote, so the confirm would show one text and the computer would send
  // another. Nothing to send means no confirm.
  const blank = body.trim() === "";
  return (
    <View
      testID="transcript.mailDraft"
      style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}
    >
      <Text style={[type.caption, { color: colors.silence }]} testID="transcript.mailDraft.to">
        {`${t("chat.mail.to")}: ${draft.toName === "" ? draft.to : `${draft.toName} <${draft.to}>`}`}
      </Text>
      <Text style={[type.bodyStrong, { color: colors.ink }]} testID="transcript.mailDraft.subject">
        {draft.subject}
      </Text>
      <Text style={[type.caption, { color: colors.silence }]}>{t("chat.mail.body")}</Text>
      <TextInput
        testID="transcript.mailDraft.body"
        value={body}
        onChangeText={setBody}
        multiline
        editable={!sent}
        accessibilityRole="text"
        accessibilityLabel={t("chat.mail.body")}
        style={[styles.field, { borderColor: colors.border, color: colors.ink }]}
      />
      {send?.status === "sent" ? (
        <Text style={[type.caption, { color: colors.accent }]} testID="transcript.mailDraft.sent">
          {t("chat.mail.sentTo", { to: send.sentTo })}
        </Text>
      ) : null}
      {send?.status === "failed" ? (
        <Text style={[type.caption, { color: colors.danger }]} testID="transcript.mailDraft.failed">
          {humanContractFailure(send.errorCode, t)}
        </Text>
      ) : null}
      {busy ? (
        <Text style={[type.caption, { color: colors.silence }]}>{t("chat.mail.sending")}</Text>
      ) : (
        <Pressable
          testID="transcript.mailDraft.send"
          accessibilityRole="button"
          accessibilityLabel={t("chat.mail.send")}
          accessibilityState={{ disabled: sent || blank }}
          disabled={sent || blank}
          onPress={() => setConfirming(true)}
          style={({ pressed }) => [
            styles.send,
            { backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={[type.label, { color: colors.onAccent }]}>{t("chat.mail.send")}</Text>
        </Pressable>
      )}
      {blank && !sent ? (
        <Text style={[type.caption, { color: colors.danger }]} testID="transcript.mailDraft.blank">
          {t("chat.mail.bodyEmpty")}
        </Text>
      ) : null}
      <MailSendConfirm
        body={body}
        colors={colors}
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          void mail?.sendDraft(draft.draftId, body);
        }}
        subject={draft.subject}
        to={draft.to}
        visible={confirming}
      />
    </View>
  );
}

const styles = {
  card: {
    ...elevation.raised,
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: radius.lg,
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  field: {
    minHeight: 96,
    maxHeight: 200,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.sm,
    textAlignVertical: "top" as const,
    ...type.body,
  },
  send: {
    minHeight: MIN_TOUCH_TARGET,
    alignItems: "center" as const,
    flexDirection: "row" as const,
    justifyContent: "center" as const,
    marginTop: spacing.sm,
    borderRadius: radius.md,
  },
} as const;