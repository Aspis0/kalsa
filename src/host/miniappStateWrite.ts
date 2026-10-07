/**
 * The sheet's write-back: a widget's next envelope `state` (a tick, an
 * answer, an edited value) lands in the stored message so it survives a
 * reload and later turns can read it. Two fences decide whether the write
 * happens at all:
 *
 * - it is a FUNCTIONAL update computed from `prev`: a stream update queued
 *   but not yet rendered must survive it — an updater built from the last
 *   rendered snapshot would silently discard it;
 * - a write whose envelope would cross the block guard's 64 KiB is refused
 *   whole (no-op): `normalizeMiniapp` drops ALL state over that cap on the
 *   next restore, so keeping the state that fits beats losing everything
 *   later.
 *
 * A live streaming message is absent from the clean projection, so the
 * direct disk write defers to the stream's own completion flush; the
 * debounced flush (`useHistoryFlushes`) converges the file to the merged
 * state either way.
 */
import type { Message } from "./hostMessage";

/** Duplicated from askAssistant.js (MAX_BLOCK_JSON_BYTES) — keep in sync:
 *  normalizeMiniappBlock degrades any block past this to {type:"unknown"},
 *  and normalizeMiniapp deletes state that would push the envelope past it. */
const MAX_BLOCK_JSON_BYTES = 64 * 1024;

/** The slice of the history host this writer borrows — structural, so the
 *  overlay module never imports the hook that builds it. */
export type MiniappStateHost = {
  messagesRef: { current: Message[] };
  persistActiveMessages: (
    msgs: Message[],
    opts?: { allowStreamingPartial?: boolean; epoch?: number },
  ) => unknown;
  setMessages: (updater: (prev: Message[]) => Message[]) => void;
};

/** Replace `miniapp.state` on the message with this id; unknown id, a
 *  message without a miniapp, or an over-cap envelope is a no-op. */
export function writeMiniappState(
  host: MiniappStateHost,
  messageId: string,
  state: Record<string, unknown>,
): void {
  const current = host.messagesRef.current;
  const target = current.find((message) => message.id === messageId);
  if (!target || !target.miniapp) return;
  try {
    if (JSON.stringify({ ...target.miniapp, state }).length > MAX_BLOCK_JSON_BYTES) {
      return;
    }
  } catch {
    return;
  }
  const patch = (prev: Message[]): Message[] =>
    prev.map((message) =>
      message.id === messageId && message.miniapp
        ? { ...message, miniapp: { ...message.miniapp, state } }
        : message,
    );
  // Functional: applies to whatever React has queued, not to this render's
  // snapshot — a stream delta in flight must not be unwritten.
  host.setMessages(patch);
  // A streamed message is absent from the clean projection: persisting then
  // would shrink the stored history. The stream's own completion flush writes
  // the tick along with the finished turn.
  if (!current.some((message) => message.streaming)) {
    host.persistActiveMessages(patch(current));
  }
}
