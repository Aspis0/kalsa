/**
 * A request the computer held for the person, and the two buttons that answer
 * it (PHONE-CHAT-PROTOCOL §3.1).
 *
 * The person is deciding on a real request to a real site, so the card shows
 * the address, the method and every field **as it would be sent** — a secret
 * as dots with a Show beside it, never as a value nobody chose to see. The
 * value is here because the person is being asked; it goes the moment they are
 * no longer being asked, which is the whole of §6's rule for the phone: the
 * card lives in memory while it can be answered, and a revealed value dies with
 * the draw that revealed it.
 *
 * **One press, ever.** The card is spent before the computer dispatches
 * anything, so a second press could only be a second message to a stranger's
 * server — a failure sentence with the buttons gone is the honest end of it.
 */
import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { useLocale } from "../../i18n";
import {
  isBrowserCardExpired,
  maskSecretQuery,
  monotonicNowMs,
  secretFieldNames,
  SECRET_DOTS,
  type BrowserCard,
  type BrowserCardEntry,
} from "../../domain/browserCardPayload";
import { answerBrowserCard, type BrowserAnswerVerb } from "../../engine/remote/browserApi";
import {
  answerLeftNothingSent,
  humanBrowserAnswerFailure,
  humanBrowserOutcome,
} from "../../engine/remote/browserOutcomeText";
import { elevation, radius, spacing, type, type DesignColors } from "../../theme/design";
import { MIN_TOUCH_TARGET } from "./shellGeometry";
import { useBrowserActions } from "./browserActions";

/** How often the budget is re-read, on the phone's own monotonic clock:
 *  the deadline is this phone's, counted down from the card's arrival. */
const TICK_MS = 1000;

export function BrowserConfirmCard({
  entry,
  colors,
}: {
  entry: BrowserCardEntry;
  colors: DesignColors;
}) {
  const { t } = useLocale();
  const browser = useBrowserActions();
  const { card, outcome } = entry;
  const [now, setNow] = useState(monotonicNowMs);
  const [pressed, setPressed] = useState(false);
  const [answer, setAnswer] = useState<Awaited<ReturnType<typeof answerBrowserCard>> | null>(null);
  /** One flag per secret field, and one for the address: what the person has
   *  chosen to look at, held here and nowhere else. */
  const [shown, setShown] = useState<ReadonlySet<string>>(() => new Set());

  const expired = isBrowserCardExpired(card, now);
  // An absent outcome is not an outcome: a card nobody answered is still open,
  // and `!== null` against `undefined` would call every card spent on arrival.
  const settled = answer !== null || outcome !== undefined;
  const live = !expired && !settled;

  /** Every way a card stops being answerable ends here. §6 is about the value
   *  GOING, not about a card that keeps it and draws dots — so the message is
   *  told, and the message drops it. Idempotent at both ends, so a press, an
   *  outcome and a deadline landing together strip once. */
  const spend = useCallback(() => {
    browser?.spentBrowserCard(card.cardId);
  }, [browser, card.cardId]);

  // An outcome settles the card from under us, with no press of ours.
  useEffect(() => {
    if (settled) spend();
  }, [settled, spend]);

  // The deadline passes while the card is drawn, and nobody presses anything.
  useEffect(() => {
    if (expired) spend();
  }, [expired, spend]);

  // The deadline passes while the card is drawn, so the card watches it — and
  // stops watching the moment nobody can answer, because a timer that outlives
  // the question is a timer keeping a stranger's value alive for nothing.
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(monotonicNowMs()), TICK_MS);
    return () => clearInterval(timer);
  }, [live, card.cardId]);

  // Expired or answered: the values go, and the flags with them (§6).
  useEffect(() => {
    if (live || shown.size === 0) return;
    setShown(new Set());
  }, [live, shown.size]);

  const toggle = useCallback((key: string) => {
    setShown((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const press = useCallback(
    async (verb: BrowserAnswerVerb) => {
      // Re-checked at the press and not only on the tick: a card that expired
      // between two renders must not put a request on the road.
      if (pressed || isBrowserCardExpired(card, monotonicNowMs())) return;
      setPressed(true);
      // Spent before the answer is even asked: the card is the one thing that
      // knows nobody may answer this any more.
      spend();
      setAnswer(await answerBrowserCard(card.cardId, verb));
    },
    [card, pressed, spend],
  );

  const secrets = secretFieldNames(card);
  // A card the message gave back has no address to show: there is nothing left
  // to decide, and the site was a stranger's all along.
  const maskedUrl = card.url === null ? null : maskSecretQuery(card.url, secrets);

  return (
    <View
      testID="transcript.browserCard"
      style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}
    >
      <Text style={[type.bodyStrong, { color: colors.ink }]} testID="transcript.browserCard.title">
        {t("chat.browser.title")}
      </Text>
      <Text style={[type.caption, { color: colors.silence }]} testID="transcript.browserCard.method">
        {`${t("chat.browser.request")}: ${card.method}`}
      </Text>
      <Text style={[type.caption, { color: colors.ink }]} testID="transcript.browserCard.url">
        {maskedUrl === null ? SECRET_DOTS : shown.has(URL_KEY) ? card.url : maskedUrl}
      </Text>
      {maskedUrl !== null && maskedUrl !== card.url ? (
        <ShowToggle
          colors={colors}
          label={shown.has(URL_KEY) ? t("chat.browser.hide") : t("chat.browser.show")}
          onPress={() => toggle(URL_KEY)}
          testID="transcript.browserCard.urlToggle"
        />
      ) : null}
      {card.fields.map((field, index) => {
        // A value that was given back has no Show: there is nothing behind it,
        // and a button that reveals dots is a lie in a control.
        const kept = field.value !== null;
        const secret = field.secret;
        const key = fieldKey(index, field.name);
        const isShown = kept && (!secret || shown.has(key));
        return (
          <View key={key} style={styles.field}>
            <Text style={[type.caption, { color: colors.silence }]}>{field.name}</Text>
            <Text style={[type.body, { color: colors.ink }]} testID={`transcript.browserCard.field.${index}`}>
              {isShown ? field.value : SECRET_DOTS}
            </Text>
            {secret && kept ? (
              <ShowToggle
                colors={colors}
                label={shown.has(key) ? t("chat.browser.hide") : t("chat.browser.show")}
                onPress={() => toggle(key)}
                testID={`transcript.browserCard.toggle.${index}`}
              />
            ) : null}
          </View>
        );
      })}
      {expired ? (
        <Text style={[type.caption, { color: colors.silence }]} testID="transcript.browserCard.expired">
          {t("chat.browser.expired")}
        </Text>
      ) : settled ? (
        <Text style={[type.caption, { color: colors.accent }]} testID="transcript.browserCard.outcome">
          {outcomeLine()}
        </Text>
      ) : (
        <Text style={[type.caption, { color: colors.silence }]} testID="transcript.browserCard.deadline">
          {t("chat.browser.answerWithin", { time: remaining(card, now) })}
        </Text>
      )}
      {live ? (
        <View style={styles.buttons}>
          <Pressable
            testID="transcript.browserCard.send"
            accessibilityRole="button"
            accessibilityLabel={t("chat.browser.send")}
            accessibilityState={{ disabled: pressed }}
            disabled={pressed}
            onPress={() => void press("send")}
            style={({ pressed: down }) => [
              styles.button,
              { backgroundColor: colors.accent, opacity: pressed ? 0.85 : down ? 0.7 : 1 },
            ]}
          >
            <Text style={[type.label, { color: colors.onAccent }]}>{t("chat.browser.send")}</Text>
          </Pressable>
          <Pressable
            testID="transcript.browserCard.decline"
            accessibilityRole="button"
            accessibilityLabel={t("chat.browser.decline")}
            accessibilityState={{ disabled: pressed }}
            disabled={pressed}
            onPress={() => void press("decline")}
            style={({ pressed: down }) => [
              styles.button,
              {
                borderColor: colors.border,
                backgroundColor: colors.surface,
                opacity: pressed ? 0.85 : down ? 0.7 : 1,
              },
            ]}
          >
            <Text style={[type.label, { color: colors.ink }]}>{t("chat.browser.decline")}</Text>
          </Pressable>
        </View>
      ) : null}
      {answer !== null && !answer.ok && outcome === undefined ? (
        <Text style={[type.caption, { color: colors.danger }]} testID="transcript.browserCard.failed">
          {humanBrowserAnswerFailure(answer.errorCode, t)}
        </Text>
      ) : null}
    </View>
  );

  /** What the card says about itself once it is settled.
   *
   *  **The computer's word wins.** An outcome can arrive queued, at the start
   *  of a later turn, and it is the computer's own account of a card this
   *  phone may still be drawing; whatever the press said locally, the later
   *  word about the same card is the truer one.
   *
   *  A local refusal is the weakest thing here: it says the ANSWER failed, not
   *  that the request was refused. Two refusals prove nothing was ever sent —
   *  the card was past its budget, or it was not this phone's to answer — and
   *  only those may say so. Everything else, a dead road included, is silence,
   *  and silence must not be dressed up as "nothing was sent". */
  function outcomeLine(): string {
    if (outcome !== undefined) return humanBrowserOutcome(outcome.code, outcome.host, t);
    if (answer === null) return t("chat.browser.unknown");
    if (answer.ok) return humanBrowserOutcome(answer.outcome.code, answer.outcome.host, t);
    return answerLeftNothingSent(answer.errorCode)
      ? humanBrowserAnswerFailure(answer.errorCode, t)
      : t("chat.browser.failUncertain");
  }
}

const URL_KEY = "url";

/** A field's own flag, by position and name: two fields with one name are two
 *  fields, and a Show that revealed both would be a Show nobody asked for. */
function fieldKey(index: number, name: string): string {
  return `${index}:${name}`;
}

/** The time left, as a person reads a clock: minutes and seconds. */
function remaining(card: BrowserCard, now: number): string {
  const seconds = Math.max(0, Math.ceil((card.deadlineAtMs - now) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function ShowToggle({
  colors,
  label,
  onPress,
  testID,
}: {
  colors: DesignColors;
  label: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.toggle, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
    >
      <Text style={[type.caption, { color: colors.accent }]}>{label}</Text>
    </Pressable>
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
  field: { gap: spacing.xxs },
  toggle: {
    alignSelf: "flex-start",
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  buttons: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  button: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    borderRadius: radius.md,
    borderWidth: 1,
  },
} as const;