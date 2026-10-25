/**
 * The long-chat nudge's latch (controller `Chat:921-922, 1314-1327`): the row
 * shows once per conversation, the first time THIS conversation crosses the
 * estimate. The row is `LongChatNudgeRow.tsx`; this hook decides when it shows.
 */
import { useEffect, useMemo, useState } from "react";
import { shouldShowLongChatNudge } from "../chat/longChatEstimate";
import type { ComposerView } from "./composerView";

export function useLongChatNudge(
  transcript: ComposerView["transcript"],
  chatEngineCtx: Parameters<typeof shouldShowLongChatNudge>[1],
  conversationId: string | undefined,
): boolean {
  // One-shot per conversation (V4.2 §Fase 3.5): the latch fires the first
  // time THIS conversation crosses the estimate; the conversation change IS
  // the controller's two resets (clearChat and load both arrive as one id
  // change here); the render gate keeps the previous conversation's row out
  // while a switch's history load is still in flight.
  const [longChatNudgeShown, setLongChatNudgeShown] = useState(false);
  // Recompute on length, resolved n_ctx and the last turn's (de)finalize —
  // NOT per token (`Chat:1318-1322`); the mapped band carries that flip as
  // `caret`/`stop` instead of the raw `streaming` flag.
  const longChat = useMemo(
    () => shouldShowLongChatNudge(transcript, chatEngineCtx),
    [
      transcript.length,
      chatEngineCtx,
      transcript[transcript.length - 1]?.caret,
      transcript[transcript.length - 1]?.stop,
    ],
  );
  useEffect(() => {
    if (longChat && !longChatNudgeShown) setLongChatNudgeShown(true);
  }, [longChat, longChatNudgeShown]);
  useEffect(() => {
    setLongChatNudgeShown(false);
  }, [conversationId]);
  return longChat && longChatNudgeShown;
}
