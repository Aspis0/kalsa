/**
 * Resume a governor-thermal-paused completion — the pause→cool→resume state
 * machine for ONE turn's completion (owner decision 2026-09-24 "A").
 *
 * One responsibility: decide when a paused completion may be attempted again,
 * and tell a single listener when cooling starts, when a retry runs, and when
 * the loop ends — with why it ended, how long the episode ran, and the
 * freshest thermo reading, so the listener's log is complete device evidence.
 * It never renders, never fails the turn, and never persists anything — the
 * caller owns all three. The give-up path deliberately RETURNS the
 * still-paused result instead of throwing, so the caller can distinguish
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
export type GovernorPauseReason = "thermal" | "profile" | "reload" | "unexplained";

/**
 * Read the pause reason structurally: the app's pinned llama.rn may predate
 * the field, and a future reason string must not be mistaken for a pause —
 * only the four known literals count, everything else is "not paused" (the
 * caller's pre-field behavior).
 */
export function pauseReasonOf(result: unknown): GovernorPauseReason | null {
  if (typeof result !== "object" || result === null) return null;
  const reason = (result as { pause_reason?: unknown }).pause_reason;
  return reason === "thermal" ||
    reason === "profile" ||
    reason === "reload" ||
    reason === "unexplained"
    ? reason
    : null;
}

/**
 * How a paused result must end its turn, or null while it is not paused:
 * `thermal` waits in the cooling loop and ends on the bound — every turn
 * completion site runs that loop first, so thermal always means the bound's
 * give-up line; every other reason has no resume path and ends on the
 * existing generic service line. The catalogue tails ARE the
 * return values so the one caller cannot re-derive the mapping.
 */
export function governorPauseEnding(
  result: unknown,
): "coolingTimedOut" | "serviceUnreachable" | null {
  const pause = pauseReasonOf(result);
  if (pause === null) return null;
  return pause === "thermal" ? "coolingTimedOut" : "serviceUnreachable";
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
  /** Loop over: see `CoolingDetail.endReason`. */
  | "end";

/** Why the loop is over — delivered only with the "end" phase. */
export type CoolingEndReason =
  /** The last attempt resolved without a thermal pause. */
  | "resumed"
  /** The turn was stopped, finished, or invalidated (switch/dispose). */
  | "stopped"
  /** The wall-clock bound expired with the reading never allowing a resume. */
  | "timeout"
  /** The retry threw; the error propagates to the caller unchanged. */
  | "failed";

export interface CoolingDetail {
  /**
   * Waiting ms since the episode began: wall time minus every retry's
   * generation, so a slow resume never inflates it (the wait ends where a
   * retry starts).
   */
  elapsedMs: number;
  /** Freshest reading any refresh returned; null before the first refresh. */
  battTempTenthsC: number | null;
  /** Total generation ms spent on retries (0 while none has run). */
  generationMs: number;
  /** Present only with the "end" phase. */
  endReason?: CoolingEndReason;
}

export interface CoolingLoopOptions<T> {
  /** One completion attempt; called again for each allowed retry. */
  attempt: () => Promise<T>;
  /** The existing thermo refresh path; may throw (swallowed: the next cycle
   *  re-reads, and a refresh failure is never a turn failure). */
  refreshThermo: () => Promise<{ batt_temp_tenths_c: number }>;
  /** The ONLY output channel of this module — no error callback exists. */
  onCooling: (phase: CoolingPhase, detail: CoolingDetail) => void;
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
  let lastTemp: number | null = null;
  let retryGenerationMs = 0;
  let boundExpired = false;
  let retryFailed = false;
  const stopped = () => isStopped() || signal?.aborted === true;
  const detail = (endReason?: CoolingEndReason): CoolingDetail => {
    const wallMs = coolingSince === null ? 0 : now() - coolingSince;
    return {
      elapsedMs: wallMs - retryGenerationMs,
      battTempTenthsC: lastTemp,
      generationMs: retryGenerationMs,
      ...(endReason !== undefined ? { endReason } : {}),
    };
  };
  try {
    while (pauseReasonOf(result) === "thermal" && !stopped()) {
      if (coolingSince === null) {
        coolingSince = now();
        onCooling("start", detail());
      } else if (now() - coolingSince >= maxCoolingMs) {
        boundExpired = true;
        break;
      }
      onCooling("wait", detail());
      await wait(pollIntervalMs, signal);
      if (stopped()) break;
      let snapshot: { batt_temp_tenths_c: number } | null = null;
      try {
        snapshot = await refreshThermo();
      } catch {
        // Not a turn failure: retry with whatever profile the engine holds.
      }
      if (snapshot !== null) lastTemp = snapshot.batt_temp_tenths_c;
      // The last gate before a retry: a stop (or a dispose) landing inside
      // the refresh must not fall through to a fresh completion on a context
      // that may already be released.
      if (stopped()) break;
      if (snapshot !== null && !readingAllowsResume(snapshot)) {
        continue; // still hot: stay in the cooling state, do not attempt
      }
      onCooling("resume", detail());
      const retryAt = now();
      try {
        result = await attempt();
      } catch (error) {
        // A throwing retry is not a cooling outcome: record it as one and
        // let the error reach the caller unchanged.
        retryFailed = true;
        throw error;
      } finally {
        retryGenerationMs += now() - retryAt;
      }
    }
  } finally {
    if (coolingSince !== null) {
      onCooling(
        "end",
        detail(
          boundExpired
            ? "timeout"
            : stopped()
              ? "stopped"
              : retryFailed
                ? "failed"
                : "resumed",
        ),
      );
    }
  }
  return result;
}
