// The send side of the attach race: while a document is being read it is in no
// conversation yet, so a send fired mid-attach builds its wire without it and
// the model answers that no file arrived. The gate is the one synchronous
// truth both sides read — the attach counts itself around its whole work, and
// the send asks at the moment Enter lands, never from a render's copy of the
// count, which lags a frame behind the same way the gate-pending freeze does.

export function createAttachGate() {
  let inFlight = 0;
  return {
    /** One attach started; the count back, for the button's face. */
    begin(): number {
      return (inFlight += 1);
    },
    /** One attach settled — a refusal settles too; the count back. */
    end(): number {
      inFlight = Math.max(0, inFlight - 1);
      return inFlight;
    },
    busy(): boolean {
      return inFlight > 0;
    },
  };
}
