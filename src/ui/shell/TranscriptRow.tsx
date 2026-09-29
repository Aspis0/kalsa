import { memo, useCallback } from "react";

import type { DesignColors } from "../../theme/design";
import { Answer, UserTurn } from "./TranscriptTurns";
import type { TranscriptStyles } from "./TranscriptParts";
import type { TranscriptLayout } from "./transcriptLayout";
import type {
  TranscriptMessage,
  TranscriptMiniapp,
  TranscriptTranslateAction,
} from "./transcriptTypes";

type TranscriptRowProps = {
  colors: DesignColors;
  labels: { show: string; hide: string; region: string };
  layout: TranscriptLayout;
  message: TranscriptMessage;
  onCopy?: (text: string) => Promise<boolean>;
  onMessageLongPress?: (message: TranscriptMessage) => void;
  onMiniappOpen?: (miniapp: TranscriptMiniapp) => void;
  onSpeak?: (id: string, text: string) => void;
  speaking: boolean;
  styles: TranscriptStyles;
  translate?: TranscriptTranslateAction;
};

/** One message owns its handlers, so rendering a changed stream row does not
 * manufacture new callbacks for the completed rows beside it. */
export const TranscriptRow = memo(function TranscriptRow({
  colors,
  labels,
  layout,
  message,
  onCopy,
  onMessageLongPress,
  onMiniappOpen,
  onSpeak,
  speaking,
  styles,
  translate,
}: TranscriptRowProps) {
  const onLongPress = useCallback(
    () => onMessageLongPress?.(message),
    [message, onMessageLongPress],
  );
  const onSpeakMessage = useCallback(
    () => onSpeak?.(message.id, message.text),
    [message.id, message.text, onSpeak],
  );

  return message.role === "user" ? (
    <UserTurn
      colors={colors}
      edited={message.edited}
      id={message.id}
      layout={layout}
      onCopy={onCopy}
      onLongPress={onMessageLongPress ? onLongPress : undefined}
      styles={styles}
      text={message.text}
      translate={translate}
    />
  ) : (
    <Answer
      caret={message.caret}
      colors={colors}
      ctas={message.ctas}
      id={message.id}
      labels={labels}
      miniapp={message.miniapp}
      onCopy={onCopy}
      onLongPress={onMessageLongPress ? onLongPress : undefined}
      onMiniappOpen={onMiniappOpen}
      onSpeak={onSpeak ? onSpeakMessage : undefined}
      readingMeasure={layout.readingMeasure}
      speaking={speaking}
      sources={message.sources}
      stale={message.stale}
      stop={message.stop}
      styles={styles}
      text={message.text}
      thinking={message.thinking}
      tools={message.tools}
      translate={translate}
    />
  );
});
