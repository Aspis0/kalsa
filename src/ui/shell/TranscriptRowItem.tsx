/**
 * One transcript row and its chrome: the rhythm gap above it and the day
 * marker, both computed from the message before it — wherever that message is
 * drawn (a settled cell above, or the last settled row under the streaming
 * footer). The list's cells and the streaming row draw through this one
 * component, so the two can never grow different chrome.
 */
import { memo } from "react";
import { Text, View } from "react-native";

import { useLocale, type TranslateFn, type TranslationKey } from "../../i18n";
import type { DesignColors } from "../../theme/design";
import type { TranscriptStyles } from "./TranscriptParts";
import { TranscriptRow } from "./TranscriptRow";
import { isSameDay, rhythmGap, shouldShowDayMarker, type TranscriptLayout } from "./transcriptLayout";
import type {
  TranscriptMessage,
  TranscriptMiniapp,
  TranscriptTranslateAction,
} from "./transcriptTypes";

/** The band's view inputs every row draws with — one object, one identity, so
 *  a token flush changes none of them and no row re-renders. */
export type RowView = {
  colors: DesignColors;
  labels: { show: string; hide: string; region: string };
  layout: TranscriptLayout;
  /** The clock the day marker compares against, as a prop so a capture is
   *  repeatable. Defaults to now. */
  now?: number;
  onCopy?: (text: string) => Promise<boolean>;
  onMessageLongPress?: (message: TranscriptMessage) => void;
  onMiniappOpen?: (miniapp: TranscriptMiniapp, messageId: string) => void;
  onSpeak?: (id: string, text: string) => void;
  speakingId?: string | null;
  styles: TranscriptStyles;
  translate?: TranscriptTranslateAction | null;
};

/** The band draws the translate action ONLY under the message it belongs to:
 *  a run keyed to another id (or to a message that no longer exists) draws
 *  nothing here — the host's orphan cleanup is the second fence, this is the
 *  first. */
export function translateFor(
  translate: TranscriptTranslateAction | null | undefined,
  messageId: string,
): TranscriptTranslateAction | undefined {
  if (!translate || translate.view.messageId !== messageId) return undefined;
  return translate;
}

/** In the order `Date.getMonth()` reports. */
const MONTH_KEYS: readonly TranslationKey[] = [
  "shell.transcript.months.jan",
  "shell.transcript.months.feb",
  "shell.transcript.months.mar",
  "shell.transcript.months.apr",
  "shell.transcript.months.may",
  "shell.transcript.months.jun",
  "shell.transcript.months.jul",
  "shell.transcript.months.aug",
  "shell.transcript.months.sep",
  "shell.transcript.months.oct",
  "shell.transcript.months.nov",
  "shell.transcript.months.dec",
];

/** Today, yesterday, or a date built from translated month names — no locale
 *  library, and every word still comes from the catalogue. */
function dayLabel(createdAt: number, now: number, t: TranslateFn): string {
  const date = new Date(createdAt);
  if (isSameDay(createdAt, now)) return t("shell.transcript.today");
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameDay(createdAt, yesterday.getTime())) return t("shell.transcript.yesterday");

  const month = t(MONTH_KEYS[date.getMonth()] ?? MONTH_KEYS[0]);
  const day = date.getDate();
  const year = date.getFullYear();
  if (year === new Date(now).getFullYear()) {
    return t("shell.transcript.onDate", { month, day });
  }
  return t("shell.transcript.onDateYear", { month, day, year });
}

type RowItemProps = {
  message: TranscriptMessage;
  /** The message drawn above this one, settled or streaming; null at the
   *  transcript's first row. */
  previous: TranscriptMessage | null;
  speaking: boolean;
  translate?: TranscriptTranslateAction;
  view: RowView;
};

export const RowItem = memo(function RowItem({
  message,
  previous,
  speaking,
  translate,
  view,
}: RowItemProps) {
  const { t } = useLocale();
  const { colors, labels, layout, styles } = view;
  // An answer opening with the cloud takes the larger, chosen gap: a different
  // object must not look welded to the green capsule.
  const opensWithCloud = message.role === "assistant" && message.thinking != null;
  const gap = rhythmGap(previous?.role ?? null, message.role, opensWithCloud);
  const marker = shouldShowDayMarker(
    previous?.createdAt ?? null,
    message.createdAt,
    layout.availableHeight,
  )
    ? dayLabel(message.createdAt, view.now ?? Date.now(), t)
    : null;

  return (
    <View style={{ marginTop: gap }} testID={`transcript.message.${message.id}`}>
      {marker ? (
        <View
          style={styles.dayMarker}
          testID={`transcript.day.${message.id}`}
          accessibilityLabel={t("shell.transcript.a11y.day", { label: marker })}
        >
          <View style={styles.hairline} />
          <Text style={styles.dayLabel}>{marker}</Text>
          <View style={styles.hairline} />
        </View>
      ) : null}
      <TranscriptRow
        colors={colors}
        labels={labels}
        layout={layout}
        message={message}
        onCopy={view.onCopy}
        onMessageLongPress={view.onMessageLongPress}
        onMiniappOpen={view.onMiniappOpen}
        onSpeak={view.onSpeak}
        speaking={speaking}
        styles={styles}
        translate={translate}
      />
    </View>
  );
});
