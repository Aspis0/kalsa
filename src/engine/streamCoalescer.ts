/**
 * Token-stream UI coalescer (~30 fps by default).
 *
 * llama.rn emits one callback per token (~5–15 tok/s). Calling setState on
 * every token wastes work; coalescing to a ~33 ms trailing flush keeps the
 * UI smooth while still showing the latest full text.
 *
 * Semantics:
 *  - `push` stores the latest full text (overwrite, never queue) and schedules
 *    a trailing flush so the LAST push always lands. If ≥ intervalMs has
 *    elapsed since the previous flush, flush immediately (leading edge).
 *  - `finalize` flushes pending text synchronously and clears the timer.
 *  - `cancel` clears timer and pending without flushing.
 *
 * Pure TS — no React. Testable under node (real or fake timers).
 */

export type StreamCoalescer = {
  push(fullText: string): void;
  finalize(): void;
  cancel(): void;
};

export function createStreamCoalescer(
  flush: (text: string) => void,
  intervalMs = 33,
): StreamCoalescer {
  let pending: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastFlushAt = 0;

  const clearTimer = () => {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const doFlush = () => {
    clearTimer();
    if (pending === null) return;
    const text = pending;
    pending = null;
    lastFlushAt = Date.now();
    flush(text);
  };

  return {
    push(fullText: string) {
      pending = fullText;
      const now = Date.now();
      const elapsed = now - lastFlushAt;
      if (lastFlushAt === 0 || elapsed >= intervalMs) {
        // Leading edge: first push, or enough time since last flush.
        doFlush();
        return;
      }
      // Trailing edge: schedule so the last push always lands.
      if (timer == null) {
        timer = setTimeout(doFlush, intervalMs - elapsed);
      }
    },

    finalize() {
      doFlush();
    },

    cancel() {
      clearTimer();
      pending = null;
    },
  };
}
