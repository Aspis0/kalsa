import { isValidElement } from "react";

import type { TranscriptProps } from "./transcriptTypes";

// Keep prop classification exhaustive so new UI inputs cannot be silently ignored.
const TRANSCRIPT_PROP_COMPARISON = {
  messages: "messages",
  empty: "empty",
  insets: "insets",
  onMessageLongPress: "identity",
  onCopy: "identity",
  onMiniappOpen: "identity",
  translate: "identity",
  speakingId: "identity",
  onSpeak: "identity",
  width: "identity",
  height: "identity",
  mode: "identity",
  now: "identity",
} satisfies Record<keyof TranscriptProps, "identity" | "messages" | "empty" | "insets">;

export function transcriptPropsEqual(previous: TranscriptProps, next: TranscriptProps): boolean {
  return (Object.keys(TRANSCRIPT_PROP_COMPARISON) as Array<keyof TranscriptProps>).every((key) => {
    switch (TRANSCRIPT_PROP_COMPARISON[key]) {
      case "identity":
        return previous[key] === next[key];
      case "messages":
        return (
          previous.messages.length === next.messages.length &&
          previous.messages.every((message, index) => message === next.messages[index])
        );
      case "empty":
        return sameEmptyContent(previous.empty, next.empty);
      case "insets":
        return (
          previous.insets.top === next.insets.top &&
          previous.insets.bottom === next.insets.bottom
        );
    }
  });
}

function sameEmptyContent(previous: TranscriptProps["empty"], next: TranscriptProps["empty"]): boolean {
  if (previous === next) return true;
  if (!isValidElement(previous) || !isValidElement(next)) return false;
  if (previous.type !== next.type || previous.key !== next.key) return false;
  const previousProps = previous.props as Record<string, unknown>;
  const nextProps = next.props as Record<string, unknown>;
  const keys = Object.keys(previousProps);
  return (
    keys.length === Object.keys(nextProps).length &&
    keys.every((key) => previousProps[key] === nextProps[key])
  );
}
