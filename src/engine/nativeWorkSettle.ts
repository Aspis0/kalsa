/**
 * The one "a unit of native engine work just ended" notification.
 *
 * `nativeEngineWorkInFlight()` (`LlamaService.ts`) is a READ: it composes the
 * native-op FIFO, the engine-job chain, the tracked completions and the chat
 * gate, and nothing can await it. A host that holds work across a turn — the
 * iOS memory guard owes a model release to a generation still running
 * (`iosMemoryGuard.ts`) — has to hear the transition instead of polling for it,
 * because a poll cannot tell a long generation from a hung op.
 *
 * The notifiers are the settle points every one of those counters passes
 * through: llamaContextGate's native-op FIFO and chat-gate transitions, and
 * LlamaService's engine-job chain. A listener must re-read
 * `nativeEngineWorkInFlight()` itself: a notification means "some work ended",
 * not "nothing is running", so one that arrives while other work is still
 * queued is harmless.
 */
const listeners = new Set<() => void>();

export function subscribeNativeWorkSettled(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyNativeWorkSettled(): void {
  // Snapshot: a listener is free to subscribe/unsubscribe from its callback.
  for (const listener of [...listeners]) listener();
}
