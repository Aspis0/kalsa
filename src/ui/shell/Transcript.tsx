/**
 * The transcript band: the conversation, and nothing else.
 *
 * Step 3 of the rebuild, with step 4's tool rows and source chips arriving as
 * two optional fields on the message (drawn inside the same entry, by
 * `TranscriptEvidence.tsx`). A leaf: it takes messages as props, reads no
 * storage, fetches nothing, subscribes to nothing, and knows nothing about a
 * conversation store, the engine or the governor. The message shape below is
 * LOCAL on purpose — the real model belongs to another layer and guessing at it
 * here would bind this file to a decision it does not own. Step 3b turns the
 * same text into markdown; step 3 renders plain text and the same text comes
 * out.
 *
 * The arithmetic lives in `./transcriptLayout.ts`, which a node test can reach;
 * this file only places the boxes it returns.
 */
import { ArrowDown } from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";

import { useLocale, type TranslateFn, type TranslationKey } from "../../i18n";
import { elevation, families, modes, radius, spacing, type } from "../../theme/design";
import { type Insets } from "./shellGeometry";
import { Answer, UserTurn, createTranscriptStyles } from "./TranscriptParts";
import {
  PROGRAMMATIC_SCROLL_GRACE_MS,
  duplicateMessageIds,
  transcriptScroll,
  type ScrollCause,
} from "./transcriptScroll";
import { isSameDay, rhythmGap, shouldShowDayMarker, transcriptLayout } from "./transcriptLayout";

export type {
  TranscriptMessage,
  TranscriptProps,
  TranscriptRole,
  TranscriptSource,
  TranscriptThinking,
  TranscriptToolCall,
} from "./transcriptTypes";
import type { TranscriptProps } from "./transcriptTypes";

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

  // ── Where the view sits. The rules live in ./transcriptScroll.ts; this only
  // obeys them. The refs are the source of truth and the two states exist only
  // to draw the control, because a state update per token would re-render the
  // whole transcript on every token of an answer.
  const scrollRef = useRef<ScrollView | null>(null);
  const contentHeightRef = useRef(0);
  const offsetRef = useRef(0);
  const countRef = useRef(messages.length);
  const pinnedRef = useRef(true);
  // When this component last issued a `scrollTo`. A programmatic scroll emits
  // `onScroll` events too, so they are ignored for a grace window rather than
  // read as the reader moving the view (see `PROGRAMMATIC_SCROLL_GRACE_MS`).
  const programmaticScrollAtRef = useRef<number | null>(null);
  const [pinned, setPinned] = useState(true);
  const [overflows, setOverflows] = useState(false);

  const decide = useCallback(
    (cause: ScrollCause) => {
      const decision = transcriptScroll({
        cause,
        contentHeight: contentHeightRef.current,
        viewportHeight: layout.availableHeight,
        offsetY: offsetRef.current,
        pinned: pinnedRef.current,
      });
      pinnedRef.current = decision.pinned;
      setPinned((current) => (current === decision.pinned ? current : decision.pinned));
      if (decision.scrollTo !== null) {
        // The first placement must not animate: a conversation that scrolls
        // itself on open looks like the bug this design is written against.
        programmaticScrollAtRef.current = Date.now();
        scrollRef.current?.scrollTo({ y: decision.scrollTo, animated: cause !== "first-layout" });
      }
    },
    [layout.availableHeight],
  );

  // The band changed height under a placed view — the keyboard opening or
  // closing. Guarded on the first layout so it cannot run before there is content.
  useEffect(() => {
    if (contentHeightRef.current === 0) return;
    decide("resize");
  }, [decide]);

  // One entry per message is what keeps an answer from being written above itself
  // and then below it: two entries for one answer is how that failure starts.
  const duplicated = useMemo(() => duplicateMessageIds(messages), [messages]);
  useEffect(() => {
    if (duplicated.length > 0) {
      console.warn(`[transcript] duplicate message ids: ${duplicated.join(", ")}`);
    }
  }, [duplicated]);
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
    <View style={styles.root}>
      <ScrollView
        accessibilityLabel={t("shell.a11y.transcript")}
        contentContainerStyle={[styles.content, { paddingBottom: layout.bottomPadding }]}
        onContentSizeChange={(_width, contentHeight) => {
          const appended = messages.length !== countRef.current;
          countRef.current = messages.length;
          contentHeightRef.current = contentHeight;
          const nextOverflows = contentHeight > layout.availableHeight;
          setOverflows((current) => (current === nextOverflows ? current : nextOverflows));
          decide(appended ? "append" : "growth");
        }}
        onLayout={() => decide("first-layout")}
        onScroll={(event) => {
          offsetRef.current = event.nativeEvent.contentOffset.y;
          // A programmatic scroll emits scroll events too. While one is still
          // in flight the offset is not the reader's opinion, so these events
          // are ignored — not obeyed and not re-pinned. Reading them as a
          // `user-scroll` here would unpin the transcript mid-animation.
          const since = programmaticScrollAtRef.current;
          if (since !== null && Date.now() - since < PROGRAMMATIC_SCROLL_GRACE_MS) return;
          decide("user-scroll");
        }}
        ref={scrollRef}
        scrollEventThrottle={16}
        style={styles.scroll}
        testID="transcript.root"
      >
      {messages.map((message, index) => {
        const previous = messages[index - 1];
        // An answer that opens with the cloud takes the larger, chosen gap: at
        // 6 dp the white blob reads as hanging off the green capsule, because it
        // is a different object and must not look welded to it.
        const opensWithCloud = message.role === "assistant" && message.thinking != null;
        const gap = rhythmGap(previous?.role ?? null, message.role, opensWithCloud);
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
                sources={message.sources}
                styles={styles}
                text={message.text}
                thinking={message.thinking}
                tools={message.tools}
              />
            )}
          </View>
        );
      })}
      </ScrollView>
      {!pinned && overflows ? (
        <Pressable
          accessibilityLabel={t("shell.a11y.jumpToEnd")}
          accessibilityRole="button"
          onPress={() => decide("jump-to-end")}
          style={styles.jump}
          testID="transcript.jumpToEnd"
        >
          <ArrowDown color={colors.inkSoft} size={20} strokeWidth={2.4} />
        </Pressable>
      ) : null}
    </View>
  );
}

