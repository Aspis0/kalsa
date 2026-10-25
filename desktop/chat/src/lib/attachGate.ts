// The send side of the attach race: while a document is being read it is in no
// conversation yet, so a send fired mid-attach builds its wire without it and
// the model answers that no file arrived. The gate is the one synchronous
// truth both sides read — the attach holds its target for the whole read, and
// the send asks at the moment Enter lands, never from a render's copy, which
// lags a frame behind the same way the gate-pending freeze does.
//
// The hold is keyed by conversation, so an attach reading for A never holds a
// question asked in B. `null` is the chat that does not exist yet: an attach
// creating one holds it, and so does a send that would create another.

export const NEW_CHAT = "new";

export function createAttachGate() {
  const held = new Set<string>();
  const busy = (key: string | null): boolean => held.has(key ?? NEW_CHAT);
  return {
    hold(key: string): void {
      held.add(key);
    },
    release(key: string): void {
      held.delete(key);
    },
    busy,
    /** The one door every send passes — a held conversation runs nothing and
        reads null, which is each caller's own "refused" answer. */
    run<T>(key: string | null, send: () => T): T | null {
      if (busy(key)) return null;
      return send();
    },
  };
}
