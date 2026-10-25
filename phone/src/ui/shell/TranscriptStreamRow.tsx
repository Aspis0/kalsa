/**
 * The streaming row, isolated from the list's data.
 *
 * While an answer streams, its message object is replaced on every coalescer
 * flush. Drawn as a list cell it would hand the list new data per token; so
 * the one message with its caret up is split OUT of the settled list here and
 * reaches its row through a context only the list's footer consumes: a flush
 * re-renders the footer and nothing else, whatever the conversation's length.
 */
import { createContext, useContext, useMemo, useRef } from "react";

import { RowItem, translateFor, type RowView } from "./TranscriptRowItem";
import type {
  TranscriptMessage,
  TranscriptTranslateAction,
} from "./transcriptTypes";

/** The settled messages and the one still streaming, if any: the last message
 *  with its caret up. */
export type TranscriptSplit = {
  settled: readonly TranscriptMessage[];
  streaming: TranscriptMessage | null;
};

export function splitStreaming(messages: readonly TranscriptMessage[]): TranscriptSplit {
  const last = messages[messages.length - 1];
  if (last?.caret === true) {
    return { settled: messages.slice(0, -1), streaming: last };
  }
  return { settled: messages, streaming: null };
}

/**
 * Test seam: how many times the split fell back to the elementwise recompute.
 * A token flush must never enter it, whatever the conversation's length —
 * `transcriptRenderCount.test.ts` holds that against N.
 */
export const splitRecomputes = { count: 0 };

/**
 * The split, with the settled array kept STABLE across flushes — in O(1).
 *
 * A flush replaces ONLY the last message object: the coalescer's `setMessages`
 * maps the array touching the assistant row alone (`sendHost.ts`, the stream
 * coalescer), and the mapper memoizes per engine message (`messageMapper.ts`,
 * a WeakMap), so every settled row keeps its `TranscriptMessage` identity.
 * Same length plus the same object one-from-the-end therefore means the whole
 * settled prefix is untouched, and the previous settled array is reused. Every
 * other updater changes the length or swaps the array whole, so it lands in
 * the recompute below — a cost paid on structure changes, not per token.
 */
export function useStreamingSplit(messages: readonly TranscriptMessage[]): TranscriptSplit {
  const cache = useRef<{ source: readonly TranscriptMessage[]; split: TranscriptSplit } | null>(null);
  const previous = cache.current;
  if (
    previous !== null &&
    messages.length === previous.source.length &&
    (messages.length < 2 ||
      messages[messages.length - 2] === previous.source[previous.source.length - 2])
  ) {
    const last = messages[messages.length - 1];
    if (last === undefined || last === previous.source[previous.source.length - 1]) {
      return previous.split;
    }
    // A caret on a row the settled list already holds cannot happen today
    // (rows are born with their caret); recompute rather than risk one answer
    // drawn twice — once as a cell, once as the footer.
    if (!(last.caret === true && previous.split.settled.length === messages.length)) {
      const reused: TranscriptSplit =
        last.caret === true
          ? { settled: previous.split.settled, streaming: last }
          : { settled: messages, streaming: null };
      cache.current = { source: messages, split: reused };
      return reused;
    }
  }
  splitRecomputes.count += 1;
  const split = splitStreaming(messages);
  cache.current = { source: messages, split };
  return split;
}

/** What the streaming row draws with: the band's view inputs plus the live
 *  message and the settled row above it (for the gap and the day marker). */
export type StreamingFeed = {
  message: TranscriptMessage | null;
  previous: TranscriptMessage | null;
  speaking: boolean;
  translate?: TranscriptTranslateAction;
  view: RowView;
};

export function useStreamingFeed(
  view: RowView,
  settled: readonly TranscriptMessage[],
  streaming: TranscriptMessage | null,
): StreamingFeed {
  return useMemo(
    () => ({
      message: streaming,
      previous: settled[settled.length - 1] ?? null,
      speaking: streaming !== null && streaming.id === view.speakingId,
      translate: translateFor(view.translate, streaming?.id ?? ""),
      view,
    }),
    [settled, streaming, view],
  );
}

const StreamingFeedContext = createContext<StreamingFeed | null>(null);

/** Hands the feed down past the list: only the footer consumes it, so an
 *  update re-renders the footer and stops there. */
export const StreamingFeedProvider = StreamingFeedContext.Provider;

/** The list's footer: the streaming row itself. Renders nothing once the
 *  answer settles and becomes an ordinary list cell. */
export function StreamingRowFooter() {
  const feed = useContext(StreamingFeedContext);
  if (feed === null || feed.message === null) return null;
  const { view } = feed;
  return (
    <RowItem
      message={feed.message}
      previous={feed.previous}
      speaking={feed.speaking}
      translate={feed.translate}
      view={view}
    />
  );
}
