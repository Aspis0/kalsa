/**
 * The mini-app sheet's write-back: a widget's next envelope `state` (a tick,
 * an answer, an edited value) lands in the stored message so it survives a
 * reload and later turns can read it. One rule decides when the bytes hit
 * disk: a live streaming message is dropped by the clean projection, so the
 * write defers to the flushes (`useHistoryFlushes`) while a turn streams and
 * persists directly the rest of the time — same guard, same epoch stamping.
 */
import type { Message } from "./hostMessage";

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

/** Replace `miniapp.state` on the message with this id; unknown id or a
 *  message without a miniapp is a no-op (the overlay outlives neither, but a
 *  stale closure must not write into the wrong conversation). */
export function writeMiniappState(
  host: MiniappStateHost,
  messageId: string,
  state: Record<string, unknown>,
): void {
  const current = host.messagesRef.current;
  const next = current.map((message) =>
    message.id === messageId && message.miniapp
      ? { ...message, miniapp: { ...message.miniapp, state } }
      : message,
  );
  if (next.every((message, index) => message === current[index])) return;
  host.setMessages(() => next);
  // A streamed message is absent from the clean projection: persisting then
  // would shrink the stored history. The stream's own completion flush writes
  // the tick along with the finished turn. Synchronous here, so the writer
  // stamps its own epoch (a clear that already landed fences the call).
  if (!next.some((message) => message.streaming)) {
    host.persistActiveMessages(next);
  }
}
