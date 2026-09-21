/**
 * The transcript band: the conversation, and nothing else.
 *
 * Step 3 of the rebuild. A leaf: it takes messages as props, reads no storage,
 * fetches nothing, subscribes to nothing, and knows nothing about a
 * conversation store, the engine or the governor. The message shape below is
 * LOCAL on purpose — the real model belongs to another layer and guessing at it
 * here would bind this file to a decision it does not own. Step 3b turns the
 * same text into markdown; step 3 renders plain text and the same text comes
 * out.
 *
 * The arithmetic lives in `./transcriptLayout.ts`, which a node test can reach;
 * this file only places the boxes it returns.
 */
import React, { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";

import { useLocale, type TranslateFn, type TranslationKey } from "../../i18n";
import {
  families,
  modes,
  radius,
  spacing,
  type,
  type DesignColors,
  type ThemeMode,
} from "../../theme/design";
import { ThoughtCloud } from "../thinking/ThoughtCloud";
import { type Insets } from "./shellGeometry";
import {
  PARAGRAPH_GAP,
  TURN_GAP,
  isSameDay,
  rhythmGap,
  shouldShowDayMarker,
  splitParagraphs,
  transcriptLayout,
  type TranscriptLayout,
} from "./transcriptLayout";

export type TranscriptRole = "user" | "assistant";

/**
 * What makes the cloud appear: reasoning that is still arriving, and whether
 * the answer itself has started. The cloud owns the gesture; these two flags
 * are all it needs to know when to rise and when to settle.
 */
export type TranscriptThinking = {
  reasoning: string;
  /** Reasoning tokens are still arriving. */
  working: boolean;
  /** Answer text has started arriving. */
  answered: boolean;
  /** Measured reasoning time, for the collapsed label once it is done. */
  reasoningMs?: number;
  /** The latest reasoning line, tracked upstream; the cloud falls back to the
   *  last line of `reasoning` when it is absent. */
  tail?: string;
};

export type TranscriptMessage = {
  id: string;
  role: TranscriptRole;
  text: string;
  createdAt: number;
  thinking?: TranscriptThinking;
};

export type TranscriptProps = {
  messages: readonly TranscriptMessage[];
  insets: Insets;
  /** Overrides for the preview; the live window is the default. */
  width?: number;
  height?: number;
  mode?: ThemeMode;
  /** The clock the day marker compares against, as a prop so a capture is
   *  repeatable. Defaults to now. */
  now?: number;
};

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

export function Transcript({
  messages,
  insets,
  width,
  height,
  mode = "light",
  now,
}: TranscriptProps) {
  const { t } = useLocale();
  const window = useWindowDimensions();
  const colors = modes[mode];
  const styles = useMemo(() => createTranscriptStyles(colors), [colors]);
  const layout = useMemo(
    () => transcriptLayout(width ?? window.width, height ?? window.height, insets),
    [width, height, window.width, window.height, insets.top, insets.bottom],
  );
  const clock = now ?? Date.now();
  // The cloud compares labels field by field, so a fresh object is safe here;
  // `colors` is NOT, and must stay `modes[mode]` — the memo compares it by
  // identity (see ThoughtCloud.tsx).
  const cloudLabels = useMemo(
    () => ({
      show: t("shell.thinking.show"),
      hide: t("shell.thinking.hide"),
      region: t("shell.a11y.thinking"),
    }),
    [t],
  );

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      testID="transcript.root"
      accessibilityLabel={t("shell.a11y.transcript")}
    >
      {messages.map((message, index) => {
        const previous = messages[index - 1];
        const gap = rhythmGap(previous?.role ?? null, message.role);
        const marker = shouldShowDayMarker(
          previous?.createdAt ?? null,
          message.createdAt,
          layout.availableHeight,
        )
          ? dayLabel(message.createdAt, clock, t)
          : null;

        return (
          <View
            key={message.id}
            style={{ marginTop: gap }}
            testID={`transcript.message.${message.id}`}
          >
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
            {message.role === "user" ? (
              <UserTurn id={message.id} layout={layout} styles={styles} text={message.text} />
            ) : (
              <Answer
                colors={colors}
                id={message.id}
                labels={cloudLabels}
                styles={styles}
                text={message.text}
                thinking={message.thinking}
              />
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

/** The only boxed turn: tinted, right-aligned, no border, no tail, one radius. */
function UserTurn({
  id,
  layout,
  styles,
  text,
}: {
  id: string;
  layout: TranscriptLayout;
  styles: ReturnType<typeof createTranscriptStyles>;
  text: string;
}) {
  return (
    <View
      style={[styles.userCapsule, { maxWidth: layout.capsuleMaxWidth }]}
      testID={`transcript.user.${id}`}
    >
      <Text style={styles.userText}>{text}</Text>
    </View>
  );
}

/** The answer is bare: serif ink on the page, full measure, no container. The
 *  cloud sits above it while that answer is still thinking. */
function Answer({
  colors,
  id,
  labels,
  styles,
  text,
  thinking,
}: {
  colors: DesignColors;
  id: string;
  labels: { show: string; hide: string; region: string };
  styles: ReturnType<typeof createTranscriptStyles>;
  text: string;
  thinking?: TranscriptThinking;
}) {
  const paragraphs = splitParagraphs(text);
  return (
    <View testID={`transcript.answer.${id}`}>
      {thinking ? (
        <ThoughtCloud
          answered={thinking.answered}
          colors={colors}
          labels={labels}
          messageId={id}
          reasoning={thinking.reasoning}
          reasoningMs={thinking.reasoningMs}
          tail={thinking.tail}
          working={thinking.working}
        />
      ) : null}
      {paragraphs.map((paragraph, index) => (
        <Text key={index} style={[styles.answer, index > 0 ? styles.paragraphGap : null]}>
          {paragraph}
        </Text>
      ))}
    </View>
  );
}

function createTranscriptStyles(colors: DesignColors) {
  return StyleSheet.create({
    root: {
      flex: 1,
    },
    content: {
      paddingBottom: TURN_GAP,
    },
    userCapsule: {
      alignSelf: "flex-end",
      backgroundColor: colors.selection,
      // Uniform 22 dp on every corner: no tail, so there is no corner to mark.
      borderRadius: radius.lg,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    userText: {
      color: colors.ink,
      fontFamily: families.sans,
      fontSize: type.body.fontSize,
      lineHeight: type.body.lineHeight,
    },
    answer: {
      color: colors.ink,
      // The reading face. Line-height 26 at 16 is 1.625, the design's ~1.62.
      fontFamily: families.reading,
      fontSize: type.body.fontSize,
      lineHeight: type.body.lineHeight,
    },
    paragraphGap: {
      marginTop: PARAGRAPH_GAP,
    },
    dayMarker: {
      alignItems: "center",
      flexDirection: "row",
      gap: spacing.sm,
      marginBottom: TURN_GAP,
    },
    hairline: {
      backgroundColor: colors.border,
      flex: 1,
      height: 1,
    },
    dayLabel: {
      color: colors.silence,
      fontFamily: families.sansMedium,
      fontSize: type.meta.fontSize,
      lineHeight: type.meta.lineHeight,
    },
  });
}
