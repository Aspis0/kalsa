/**
 * The mail a remote answer brought, as the list a person reads it in.
 *
 * Every word on a card is a stranger's: the subject and the gist are the
 * mail's own, and they are drawn as plain text. What the app adds is the
 * caution the desktop shows when the computer flagged a mail, and the two
 * actions the contract gives a card — open it, or ask the computer for a
 * reply.
 */
import { memo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { useLocale, type TranslationKey } from "../../i18n";
import { senderLine, type MailCardItem, type MailCards } from "../../domain/mailPayload";
import { elevation, radius, spacing, type, type DesignColors } from "../../theme/design";
import { MIN_TOUCH_TARGET } from "./shellGeometry";
import { useMailActions } from "./mailActions";

/** Why the computer flagged a mail, in the app's language. The codes are
 *  `kalsa-mail`'s (`label/mod.rs`); a code this build has no words for is
 *  dropped rather than shown as itself, exactly as the desktop does. */
const REASON_KEYS: Record<string, TranslationKey> = {
  auth_fail: "chat.mail.reasonAuthFail",
  reply_to_mismatch: "chat.mail.reasonReplyToMismatch",
  display_spoof: "chat.mail.reasonDisplaySpoof",
  link_mismatch: "chat.mail.reasonLinkMismatch",
  ip_link: "chat.mail.reasonIpLink",
  shortener: "chat.mail.reasonShortener",
  punycode: "chat.mail.reasonPunycode",
  payment_urgency_new_sender: "chat.mail.reasonPaymentUrgency",
  hidden_text: "chat.mail.reasonHiddenText",
};

function MailRow({ item, colors }: { item: MailCardItem; colors: DesignColors }) {
  const { t } = useLocale();
  const mail = useMailActions();
  const suspicious = item.label === "suspicious";
  const reasons = suspicious
    ? item.reasons.filter((code) => Object.prototype.hasOwnProperty.call(REASON_KEYS, code))
    : [];
  return (
    <View
      testID={`transcript.mail.card.${item.id}`}
      style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}
    >
      <Text style={[type.bodyStrong, { color: colors.ink }]} numberOfLines={2}>
        {item.subject}
      </Text>
      <Text style={[type.caption, { color: colors.silence }]} numberOfLines={1}>
        {senderLine(item.from)}
      </Text>
      {item.gist !== "" ? (
        <Text style={[type.secondary, { color: colors.ink }]} numberOfLines={3}>
          {item.gist}
        </Text>
      ) : null}
      {suspicious ? (
        <View style={styles.warning}>
          <Text style={[type.caption, { color: colors.danger }]} testID={`transcript.mail.flag.${item.id}`}>
            {t("chat.mail.suspicious")}
          </Text>
          {reasons.map((code) => (
            <Text
              key={code}
              style={[type.caption, { color: colors.danger }]}
              testID={`transcript.mail.reason.${item.id}.${code}`}
            >
              {`· ${t(REASON_KEYS[code])}`}
            </Text>
          ))}
        </View>
      ) : null}
      {mail ? (
        <View style={styles.actions}>
          <Pressable
            testID={`transcript.mail.open.${item.id}`}
            accessibilityRole="button"
            accessibilityLabel={t("chat.mail.open")}
            onPress={() => mail.readMail(item.id)}
            style={({ pressed }) => [styles.action, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Text style={[type.label, { color: colors.accent }]}>{t("chat.mail.open")}</Text>
          </Pressable>
          <Pressable
            testID={`transcript.mail.reply.${item.id}`}
            accessibilityRole="button"
            accessibilityLabel={t("chat.mail.replyDraft")}
            onPress={() => mail.draftReply(item.id)}
            style={({ pressed }) => [styles.action, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Text style={[type.label, { color: colors.accent }]}>{t("chat.mail.replyDraft")}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/** How many cards one list draws before its button asks. A turn is not a page:
 *  past this the person decides to keep reading. The rest are already in hand,
 *  so the button reveals and never fetches — the desktop draws it the same way. */
const DRAWN = 8;

export const MailCardList = memo(function MailCardList({
  cards,
  colors,
}: {
  cards: MailCards;
  colors: DesignColors;
}) {
  const { t } = useLocale();
  const [revealed, setRevealed] = useState(false);
  const drawn = revealed ? cards.items : cards.items.slice(0, DRAWN);
  const rest = cards.items.length - drawn.length;
  const more =
    rest === 1 ? t("chat.mail.oneMoreMail") : t("chat.mail.moreMail", { count: rest });
  return (
    <View testID="transcript.mail.cards" style={styles.list}>
      {drawn.map((item) => (
        <MailRow key={item.id} item={item} colors={colors} />
      ))}
      {rest > 0 ? (
        <Pressable
          testID="transcript.mail.more"
          accessibilityRole="button"
          accessibilityLabel={more}
          onPress={() => setRevealed(true)}
          style={({ pressed }) => [styles.more, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Text style={[type.label, { color: colors.accent }]}>{more}</Text>
        </Pressable>
      ) : null}
      {cards.bulk > 0 ? (
        // A line, not a card each: the count is the computer's and the desktop
        // draws it the same way.
        <Text style={[type.caption, { color: colors.silence }]} testID="transcript.mail.bulk">
          {cards.bulk === 1
            ? t("chat.mail.oneNewsletter")
            : t("chat.mail.newsletters", { count: cards.bulk })}
        </Text>
      ) : null}
      <Text style={[type.caption, { color: colors.silence }]} testID="transcript.mail.careful">
        {t("chat.mail.careful")}
      </Text>
    </View>
  );
});

const styles = {
  list: { gap: spacing.sm, paddingTop: spacing.sm },
  card: {
    ...elevation.raised,
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  warning: { gap: spacing.xs, paddingTop: spacing.xs },
  actions: { flexDirection: "row" as const, gap: spacing.sm, paddingTop: spacing.sm },
  action: {
    minHeight: MIN_TOUCH_TARGET,
    alignItems: "center" as const,
    flexDirection: "row" as const,
    justifyContent: "center" as const,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  more: {
    minHeight: MIN_TOUCH_TARGET,
    alignItems: "center" as const,
    flexDirection: "row" as const,
    justifyContent: "center" as const,
  },
} as const;