/**
 * Per-turn fencing for message updates.
 *
 * The old screen re-checked the pair `regenGenerationRef` / `sendRunIdRef`
 * at every stream callback and inside every deferred setState updater
 * (AiChatPage:2570, 2614, 2694, 1970-1993 are samples of the set). That
 * pair is exactly what a stale callback can forget to present: ownerGen
 * and ownerRunId were optional on updateMessage. Here a turn is issued ONE
 * token and every mutation requires it — an unfenced update is no longer
 * expressible, and a token issued before a clear/switch/new run can never
 * validate again.
 *
 * Bump pairing, from the old code: every invalidation (clear, conversation
 * switch, unmount, stop-watchdog) bumps BOTH counters (AiChatPage:1866,
 * 1928, 3161, 3244+3264); only a new send bumps the run id alone (2308),
 * which is what beginRun() re-expresses.
 */

/** Module-private brand: outside code cannot name it, so it cannot mint tokens. */
const TURN_TOKEN: unique symbol = Symbol("kalsa.turnToken");

interface TurnIdentity {
  generation: number;
  runId: number;
}

export interface TurnToken {
  readonly [TURN_TOKEN]: TurnIdentity;
}

export interface TurnFence {
  /**
   * Start a send run: bumps the run id and issues the token every update of
   * this run must present. Call at run start (old claim site, AiChatPage:
   * 2254/2308 collapsed into one issue point — every other sendRunIdRef
   * bump site also bumps the generation, so nothing can intervene between
   * the two old capture points without triing the generation check).
   */
  beginRun(): TurnToken;
  /**
   * Retire every outstanding token (clear / conversation switch / unmount /
   * stop-watchdog). Both counters move, so neither half of the old pair can
   * be presented alone.
   */
  invalidate(): void;
  /** True while the token still owns the turn. */
  owns(token: TurnToken): boolean;
  /**
   * Run `update` only for a live token; a stale token returns `state`
   * untouched (same reference — a refused update changes nothing). Call
   * inside the setState updater: ownership is re-checked when the updater
   * actually runs, which is what stops a Fabric-queued update that was
   * scheduled before a clear (AiChatPage:2904-2910).
   */
  apply<T>(token: TurnToken, state: T, update: (state: T) => T): T;
}

export function createTurnFence(): TurnFence {
  let generation = 0;
  let runId = 0;

  const issue = (): TurnToken =>
    Object.freeze({ [TURN_TOKEN]: Object.freeze({ generation, runId }) });

  const owns = (token: TurnToken): boolean => {
    const id = token[TURN_TOKEN];
    return id.generation === generation && id.runId === runId;
  };

  return {
    beginRun() {
      runId += 1;
      return issue();
    },
    invalidate() {
      runId += 1;
      generation += 1;
    },
    owns,
    apply(token, state, update) {
      return owns(token) ? update(state) : state;
    },
  };
}
