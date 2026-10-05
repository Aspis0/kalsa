/**
 * The transcript band: the conversation, and nothing else.
 *
 * A leaf: it takes messages as props, reads no storage, fetches nothing,
 * subscribes to nothing, and knows nothing about a conversation store, the
 * engine or the governor. Tool rows and source chips arrive as two optional
 * message fields drawn inside the same entry by `TranscriptEvidence`. The
 * arithmetic lives in `./transcriptLayout.ts` (rhythm, day markers) and
 * `./transcriptWindow.ts` (how much of a long conversation the list holds);
 * this file only places the boxes they return.
 *
 * The conversation draws in a FlatList, not a ScrollView that maps every
 * message: only a window of rows mounts, and the frame cost of a streaming
 * answer no longer grows with the conversation's length. The streaming row
 * never enters the list's data at all — it rides the context feed in
 * `TranscriptStreamRow.tsx`, so a token flush re-renders only that row.
 */

import { ArrowDown } from "lucide-react-native";
import { isValidElement, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Pressable,
  Text,
  View,
  useWindowDimensions,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";

import { useLocale } from "../../i18n";
import { modes } from "../../theme/design";
import { TranscriptEdgeFade } from "./TranscriptEdgeFade";
import { createTranscriptStyles } from "./TranscriptParts";
import { RowItem, translateFor, type RowView } from "./TranscriptRowItem";
import {
  StreamingFeedProvider,
  StreamingRowFooter,
  useStreamingFeed,
  useStreamingSplit,
} from "./TranscriptStreamRow";
import { transcriptPropsEqual } from "./transcriptMemo";
import {
  PROGRAMMATIC_SCROLL_GRACE_MS,
  duplicateMessageIds,
  transcriptScroll,
  type ScrollCause,
} from "./transcriptScroll";
import { transcriptLayout } from "./transcriptLayout";
import { TRANSCRIPT_WINDOW_BATCH, TRANSCRIPT_WINDOW_SIZE, TRANSCRIPT_WINDOW_TAIL } from "./transcriptWindow";
import { useTranscriptWindow } from "./useTranscriptWindow";

export type {
  TranscriptMessage,
  TranscriptProps,
  TranscriptRole,
  TranscriptSource,
  TranscriptThinking,
  TranscriptToolCall,
} from "./transcriptTypes";
import type { TranscriptMessage, TranscriptProps } from "./transcriptTypes";

/** The reader's place through a prepend is the scroll view's own job, native
 *  on both platforms; the module-level constant keeps the prop identity stable
 *  so the list's pure-component check still holds. */
const KEEP_PLACE = { minIndexForVisible: 0 };

function TranscriptContent({
  messages,
  empty,
  insets,
  onCopy,
  onMessageLongPress,
  onMiniappOpen,
  onSpeak,
  speakingId,
  translate,
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

  const { settled, streaming } = useStreamingSplit(messages);
  const { listData, prependIfNearTop, trimToTail, windowStart } = useTranscriptWindow(settled);

  // ── Where the view sits. The rules live in ./transcriptScroll.ts; this only
  // obeys them. Refs decide; the two states exist only to draw the control,
  // because a state update per token would re-render the transcript per token.
  const scrollRef = useRef<FlatList | null>(null);
  const contentHeightRef = useRef(0);
  const offsetRef = useRef(0);
  // The messages count at the last content-size event, and at this render: the
  // stable content-size callback compares the two to tell an append from growth.
  const countRef = useRef(messages.length);
  const renderedCountRef = useRef(messages.length);
  renderedCountRef.current = messages.length;
  const pinnedRef = useRef(true);
  // The first-layout-done FACT, reported into the machine as `placedBefore`:
  // `onLayout` fires for every re-layout and the event itself is identical for
  // the first layout and the hundredth. A ref, not state: it decides a scroll,
  // never a draw.
  const placedRef = useRef(false);
  // When this component last issued a programmatic scroll: its own `onScroll`
  // events are ignored for a grace window, not read as the reader's opinion
  // (see `PROGRAMMATIC_SCROLL_GRACE_MS`).
  const programmaticScrollAtRef = useRef<number | null>(null);
  const [pinned, setPinned] = useState(true);
  const [overflows, setOverflows] = useState(false);
  // Whether content has scrolled under the band's TOP edge. Updated before the
  // grace-window return below, because a programmatic `scrollTo` moves the
  // offset too and its events are otherwise ignored on purpose.
  const [topClipped, setTopClipped] = useState(false);

  const decide = useCallback(
    (cause: ScrollCause) => {
      const decision = transcriptScroll({
        cause,
        contentHeight: contentHeightRef.current,
        viewportHeight: layout.availableHeight,
        offsetY: offsetRef.current,
        pinned: pinnedRef.current,
        // Kept in step with `contentHeightRef` in `onContentSizeChange`, the same
        // measurement pass: the machine decides what an empty transcript means,
        // the view only reports.
        messageCount: countRef.current,
        // The other fact the view reports: whether anything was placed before
        // THIS event. Everything else about deciding stays in the machine.
        placedBefore: placedRef.current,
      });
      pinnedRef.current = decision.pinned;
      setPinned((current) => (current === decision.pinned ? current : decision.pinned));
      if (decision.scrollTo !== null) {
        // Only the GENUINE first placement must not animate: a conversation
        // that scrolls itself on open looks like the bug this design is written
        // against. A later layout arrives as the same cause and animates like
        // any other resize (the machine folded it via `placedBefore`).
        const firstPlacement = cause === "first-layout" && !placedRef.current;
        programmaticScrollAtRef.current = Date.now();
        scrollRef.current?.scrollToOffset({ animated: !firstPlacement, offset: decision.scrollTo });
      }
    },
    [layout.availableHeight],
  );

  // One page of history above the window when the reader nears its top. Runs
  // outside the programmatic grace window, so a scroll the band itself started
  // (the first placement, a jump) cannot page history in as it passes the top.
  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      offsetRef.current = event.nativeEvent.contentOffset.y;
      const scrolled = offsetRef.current > 0;
      // Same value in, no re-render out: this flips only when the view
      // crosses the top, not on every scroll frame.
      setTopClipped((was) => (was === scrolled ? was : scrolled));
      // A programmatic scroll emits scroll events too. While one is in
      // flight the offset is not the reader's opinion: ignored — not obeyed
      // and not re-pinned. Reading them here would unpin mid-animation.
      const since = programmaticScrollAtRef.current;
      if (since !== null && Date.now() - since < PROGRAMMATIC_SCROLL_GRACE_MS) return;
      prependIfNearTop(offsetRef.current);
      decide("user-scroll");
    },
    [decide, prependIfNearTop],
  );

  // The band changed height under a placed view — the keyboard opening or
  // closing. Guarded on the first layout so it cannot run before there is content.
  useEffect(() => {
    if (contentHeightRef.current === 0) return;
    decide("resize");
  }, [decide]);

  // One entry per message is what keeps an answer from being written above
  // itself and then below it: two entries for one answer is how it starts.
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

  // The view inputs every row draws with — one memo, so each callback below is
  // a stable identity between user actions, the list (a pure component) skips
  // a token flush entirely, and only the footer, fed by context, re-renders.
  const view = useMemo<RowView>(
    () => ({
      colors,
      labels: cloudLabels,
      layout,
      now,
      onCopy,
      onMessageLongPress,
      onMiniappOpen,
      onSpeak,
      speakingId,
      styles,
      translate,
    }),
    [
      colors,
      cloudLabels,
      layout,
      now,
      onCopy,
      onMessageLongPress,
      onMiniappOpen,
      onSpeak,
      speakingId,
      styles,
      translate,
    ],
  );
  const feed = useStreamingFeed(view, settled, streaming);

  const onContentSizeChange = useCallback(
    (_width: number, contentHeight: number) => {
      const appended = renderedCountRef.current !== countRef.current;
      countRef.current = renderedCountRef.current;
      contentHeightRef.current = contentHeight;
      const nextOverflows = contentHeight > layout.availableHeight;
      setOverflows((current) => (current === nextOverflows ? current : nextOverflows));
      decide(appended ? "append" : "growth");
    },
    [decide, layout.availableHeight],
  );

  const onLayout = useCallback(() => {
    // The first of these is a placement (offset 0 for the welcome block,
    // the end for a conversation); every one after it is a RE-layout under
    // a placed view, and the reader's position must survive it. The event
    // cannot say which it is, so the ref does; the machine decides.
    decide("first-layout");
    placedRef.current = true;
  }, [decide]);

  const extractKey = useCallback((message: TranscriptMessage) => message.id, []);

  const renderItem = useCallback(
    ({ index, item }: ListRenderItemInfo<TranscriptMessage>) => {
      // The gap and marker read the row's real predecessor, which may sit one
      // page above the drawn slice.
      const absolute = windowStart + index;
      const previous = absolute > 0 ? settled[absolute - 1] : null;
      return (
        <RowItem
          message={item}
          previous={previous}
          speaking={item.id === view.speakingId}
          translate={translateFor(view.translate, item.id)}
          view={view}
        />
      );
    },
    [settled, view, windowStart],
  );

  const contentStyle = useMemo(
    () => [styles.content, { paddingBottom: layout.bottomPadding }],
    [styles, layout.bottomPadding],
  );

  // The welcome rides the list's empty state; the list wants an element, the prop a node.
  const welcome = messages.length === 0 && isValidElement(empty) ? empty : null;

  return (
    <View style={styles.root}>
      <StreamingFeedProvider value={feed}>
        <FlatList
          accessibilityLabel={t("shell.a11y.transcript")}
          contentContainerStyle={contentStyle}
          data={listData}
          initialNumToRender={TRANSCRIPT_WINDOW_TAIL}
          keyExtractor={extractKey}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={welcome}
          ListFooterComponent={StreamingRowFooter}
          maintainVisibleContentPosition={KEEP_PLACE}
          maxToRenderPerBatch={TRANSCRIPT_WINDOW_BATCH}
          onContentSizeChange={onContentSizeChange}
          onLayout={onLayout}
          onScroll={onScroll}
          ref={scrollRef}
          renderItem={renderItem}
          scrollEventThrottle={16}
          style={styles.scroll}
          testID="transcript.root"
          windowSize={TRANSCRIPT_WINDOW_SIZE}
        />
      </StreamingFeedProvider>
      {/* Placement is the z-order argument: after the list the fade paints
          over the content it dissolves; before the jump control it paints UNDER
          it (React Native paints siblings in document order), so the control's
          ring is not faded. Inside this root, which the shell clips to the
          transcript band, it cannot reach the notice or composer bands. */}
      <TranscriptEdgeFade colors={colors} topClipped={topClipped} />
      {!pinned && overflows ? (
        <Pressable
          accessibilityLabel={t("shell.a11y.jumpToEnd")}
          accessibilityRole="button"
          onPress={() => {
            trimToTail();
            decide("jump-to-end");
          }}
          style={styles.jumpBox}
          testID="transcript.jumpToEnd"
        >
          <View style={styles.jump}>
            <ArrowDown color={colors.ink2} size={16} strokeWidth={1.75} />
            <Text style={styles.jumpLabel}>{t("shell.a11y.jumpLabel")}</Text>
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Transcript(props: TranscriptProps) {
  return <MemoizedTranscriptContent {...props} />;
}

const MemoizedTranscriptContent = memo(TranscriptContent, transcriptPropsEqual);
