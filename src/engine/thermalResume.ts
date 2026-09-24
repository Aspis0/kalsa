/**
 * Resume a governor-thermal-paused completion — the pause→cool→resume state
 * machine for ONE turn's completion (owner decision 2026-09-24 "A").
 *
 * One responsibility: decide when a paused completion may be attempted again,
 * and tell a single listener when cooling starts, when a retry runs, and when
 * the loop ends. It never renders, never fails the turn, and never persists
 * anything — the caller owns all three. The give-up path deliberately RETURNS
 * the still-paused result instead of throwing, so the caller can distinguish
 * "resumed" from "bound expired" by reading `pause_reason` again.
 *
 * Background honesty: the wait is a plain RN timer, which Android suspends
 * while the host is paused. Nothing is lost — the wait resolves on foreground
 * return — and the bound is wall-clock (`now`), re-checked at the top of each
 * cycle, so a long background cannot extend cooling forever, and the first
 * cycle after waking always refreshes the thermo reading and retries when the
 * reading allows it.
 */

/** The binding's typed pause outcome (llama.rn `pause_reason`). */
export type GovernorPauseReason = "thermal" | "profile" | "reload";

/**
 * Read the pause reason structurally: the app's pinned llama.rn may predate
 * the field, and a future reason string must not be mistaken for a pause —
 * only the three known literals count, everything else is "not paused" (the
 * caller's pre-field behavior).
 */
export function pauseReasonOf(result: unknown): GovernorPauseReason | null {
  if (typeof result !== "object" || result === null) return null;
  const reason = (result as { pause_reason?: unknown }).pause_reason;
  return reason === "thermal" || reason === "profile" || reason === "reload"
    ? reason
    : null;
}

/**
 * The engine's warn line, mirrored as the resume gate: below 40.0 °C
 * admission never waits (owner decision 2026-09-24, engine 497ca1cc
 * `k_warn_c`), so a fresh reading under this value is exactly "the governor
 * thermo reading allows". If the engine moves its warn line, this constant
 * must move with it — the failure mode of a stale copy is a resume that
 * retries too eagerly and pauses again (bounded), never a stuck turn.
 */
export const GOVERNOR_PAUSE_RESUME_TEMP_TENTHS_C = 400;

/** How long to wait between thermo reads while cooling. */
export const GOVERNOR_COOLING_POLL_MS = 10_000;
/** Wall-clock bound on one cooling episode; then the caller decides. */
export const GOVERNOR_COOLING_MAX_MS = 10 * 60_000;

export type CoolingPhase =
  /** First pause of this episode: the listener shows the cooling state. */
  | "start"
  /** About to wait for the next poll (still cooling — keeps that state). */
  | "wait"
  /** About to attempt again (the reading allowed it). */
  | "resume"
  /** Loop over: resumed, stopped, or bound expired. */
  | "end";

export interface CoolingLoopOptions<T> {
  /** One completion attempt; called again for each allowed retry. */
  attempt: () => Promise<T>;
  /** The existing thermo refresh path; may throw (swallowed: the next cycle
   *  re-reads, and a refresh failure is never a turn failure). */
  refreshThermo: () => Promise<{ batt_temp_tenths_c: number }>;
  /** The ONLY output channel of this module — no error callback exists. */
  onCooling: (phase: CoolingPhase) => void;
  /** Turn liveness: finished/aborted/disposed, as the caller defines it. */
  isStopped: () => boolean;
  signal?: AbortSignal;
  pollIntervalMs?: number;
  maxCoolingMs?: number;
  now?: () => number;
  /** Injectable for tests; defaults to the cancellable RN-timer wait. */
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/**
 * Wait `ms`, resolving early when the signal aborts (the timer is cleared, so
 * an abort during background-suspended waits leaves no armed callback behind).
 */
function waitOrAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted === true) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function readingAllowsResume(snapshot: { batt_temp_tenths_c: number }): boolean {
  // A snapshot without a sensor reads 0 (governorInputs' fallback), which is
  // "allow and let the engine judge" — the same side of the gate an honest
  // cool reading lands on.
  return snapshot.batt_temp_tenths_c < GOVERNOR_PAUSE_RESUME_TEMP_TENTHS_C;
}

/**
 * Run `attempt` and, while it resolves as a thermal pause with the turn
 * alive, wait → refresh the thermo → retry once the reading allows. Returns
 * the final result (resumed, still paused at the bound, or mid-episode when
 * the turn stopped). No cooling episode → `attempt` runs exactly once and no
 * listener phase fires.
 *
 * Phase order: `start` (once), then per cycle `wait` → … → `resume`, and
 * `end` once — so a listener can clear turn timers before each wait and
 * re-arm them before each attempt.
 */
export async function resumeWhileCooling<T>(
  options: CoolingLoopOptions<T>,
): Promise<T> {
  const {
    attempt,
    refreshThermo,
    onCooling,
    isStopped,
    signal,
    pollIntervalMs = GOVERNOR_COOLING_POLL_MS,
    maxCoolingMs = GOVERNOR_COOLING_MAX_MS,
    now = Date.now,
    wait = waitOrAbort,
  } = options;

  let result = await attempt();
  let coolingSince: number | null = null;
  try {
    while (pauseReasonOf(result) === "thermal" && !isStopped()) {
      if (coolingSince === null) {
        coolingSince = now();
        onCooling("start");
      } else if (now() - coolingSince >= maxCoolingMs) {
        break;
      }
      onCooling("wait");
      await wait(pollIntervalMs, signal);
      if (isStopped()) break;
      let snapshot: { batt_temp_tenths_c: number } | null = null;
      try {
        snapshot = await refreshThermo();
      } catch {
        // Not a turn failure: retry with whatever profile the engine holds.
      }
      if (isStopped()) break;
      if (snapshot !== null && !readingAllowsResume(snapshot)) {
        continue; // still hot: stay in the cooling state, do not attempt
      }
      onCooling("resume");
      result = await attempt();
    }
  } finally {
    if (coolingSince !== null) onCooling("end");
  }
  return result;
}
