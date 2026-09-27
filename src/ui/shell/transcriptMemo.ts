import { isValidElement } from "react";

import type { TranscriptProps } from "./transcriptTypes";

export function transcriptPropsEqual(previous: TranscriptProps, next: TranscriptProps): boolean {
  const prevMessages = previous.messages;
  const nextMessages = next.messages;
  return (
    prevMessages.length === nextMessages.length &&
    prevMessages.every((message, index) => message === nextMessages[index]) &&
    sameEmptyContent(previous.empty, next.empty) &&
    previous.insets.top === next.insets.top &&
    previous.insets.bottom === next.insets.bottom &&
    previous.onCopy === next.onCopy &&
    previous.onMessageLongPress === next.onMessageLongPress &&
    previous.onMiniappOpen === next.onMiniappOpen &&
    previous.onSpeak === next.onSpeak &&
    previous.speakingId === next.speakingId &&
    previous.translate === next.translate &&
    previous.width === next.width &&
    previous.height === next.height &&
    previous.mode === next.mode &&
    previous.now === next.now
  );
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
