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

function sameSettled(
  previous: readonly TranscriptMessage[],
  next: readonly TranscriptMessage[],
): boolean {
  return previous.length === next.length && previous.every((message, index) => message === next[index]);
}

/**
 * The split, with the settled array kept STABLE across flushes: a flush
 * replaces the streaming object and leaves the settled prefix alone, so the
 * list's data does not change while the tokens arrive. (A fresh slice per
 * render would be elementwise equal and still a new array — enough to wake
 * the whole list.)
 */
export function useStreamingSplit(messages: readonly TranscriptMessage[]): TranscriptSplit {
  const cache = useRef<TranscriptSplit | null>(null);
  const split = splitStreaming(messages);
  const previous = cache.current;
  if (previous !== null && sameSettled(previous.settled, split.settled)) {
    const kept = { settled: previous.settled, streaming: split.streaming };
    cache.current = kept;
    return kept;
  }
  cache.current = split;
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
