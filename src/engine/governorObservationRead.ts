/**
 * The Stage 0 observation read (learning-governor DESIGN.md 3.2): one
 * GovernorStats fetch per completed completion, fed to the pure row builder.
 * Owns the previous-snapshot baseline and the gap flag. Two invariants the
 * service must keep: every path that clears the engine's decode counters
 * (a live cache clear, the engine teardown) calls resetObservationBaseline,
 * and every path that skips the read after a completion ran (stop, pause,
 * timeout) calls markObservationGap — otherwise the next row's deltas span
 * two completions with gap:0.
 */
import type { LlamaContext } from "llama.rn";
import { getCachedDeviceProfile } from "./deviceProfile";
import {
  buildObservationRow,
  type GovernorObservationRow,
  type GovernorObservationStats,
  type ObservationCompletion,
  type ObservationThermo,
} from "./governorObservation";
import { withNativeCallTimeout } from "./nativeCallTimeout";

/** The read's own bound (not ENGINE_AUX_CALL_TIMEOUT_MS): the next
 *  completion's beginCompletion resets the binding record, so a lazy read
 *  would observe the wrong completion — and a slow read must not delay the
 *  next tool round by more than this. */
export const OBSERVATION_STATS_TIMEOUT_MS = 2_000;

let prevStats: GovernorObservationStats | null = null;
let gapPending = false;
// Bumped by every baseline reset. A read captures it at start: teardown can
// run while an old turn's read is still in flight (disposal does not abort
// the turn controller), and a stats answer from the old engine must neither
// log a row nor seed the next engine's baseline.
let generation = 0;

/** The engine's decode counters restart from zero; the delta baseline and
 *  the gap flag restart with them. */
export function resetObservationBaseline(): void {
  prevStats = null;
  gapPending = false;
  generation += 1;
}

/** The completion before the next read was skipped: its counters fold into
 *  the next row, which must carry gap:1. */
export function markObservationGap(): void {
  gapPending = true;
}

export type ObservationReadArgs = {
  engine: LlamaContext;
  /** The turn's abort signal: a stop requested mid-read ends the wait
   *  immediately, so stop latency equals the pre-observation behavior. */
  signal: AbortSignal | undefined;
  governorActive: boolean;
  thermo: ObservationThermo;
  model: string;
  turnId: string;
  round: number;
  attempt: number;
  completion: ObservationCompletion;
};

export async function readGovernorObservationRow(
  args: ObservationReadArgs,
): Promise<GovernorObservationRow | null> {
  if (!args.governorActive) return null;
  const gap = gapPending;
  gapPending = false;
  const stopRace = new Promise<never>((_, reject) => {
    if (args.signal?.aborted) {
      reject(new Error("observation aborted by stop"));
      return;
    }
    args.signal?.addEventListener(
      "abort",
      () => reject(new Error("observation aborted by stop")),
      { once: true },
    );
  });
  // The race stops listening once the read wins; swallow the loser's late
  // rejection so RN never logs an unhandled one.
  stopRace.catch(() => undefined);
  const startGeneration = generation;
  try {
    const stats = (await withNativeCallTimeout(
      Promise.race([args.engine.getGovernorStats(), stopRace]),
      OBSERVATION_STATS_TIMEOUT_MS,
      "getGovernorStats",
    )) as GovernorObservationStats;
    const deviceProfile = await getCachedDeviceProfile();
    if (generation !== startGeneration) {
      // The engine identity or its counters restarted under the read: these
      // stats belong to the old engine. No row, no baseline, and the
      // completion's skipped read shows up as the next row's gap.
      gapPending = true;
      return null;
    }
    const row = buildObservationRow(
      prevStats,
      stats,
      args.completion,
      args.thermo,
      {
        turnId: args.turnId,
        round: args.round,
        attempt: args.attempt,
        gap,
        model: args.model,
        soc: deviceProfile.socModel ?? "",
      },
    );
    prevStats = stats;
    return row;
  } catch {
    // Timeout, stop, or a native failure: no row, and the next one spans the
    // gap. A late settlement of the raced read is dropped, never written.
    gapPending = true;
    return null;
  }
}
