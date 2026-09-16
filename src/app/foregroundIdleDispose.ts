/** Quiet foreground idle before save+dispose. Engine stays loaded after a turn. */
export const FOREGROUND_IDLE_DISPOSE_MS = 180_000;

/**
 * Decode liveness bound. Jelly t20c-gate 2026-09-16 turn 4 (alive) emitted 934
 * native progress lines over 17 min with a max gap of 21.7 s, so 45 s of token
 * silence means production stopped; matches GENERATION_STALL_GAP_MS.
 */
export const FOREGROUND_TOKEN_SILENCE_MS = 45_000;

/**
 * Pre-first-token net (loadPrompt can hang before any token exists). Same
 * rationale as the pre-c37b419 stuck limit: ~3.4 tok/s × 1024 n_predict plus
 * headroom, and still bounds overnight drain from a wedged engine.
 */
export const FOREGROUND_STUCK_INFLIGHT_MS = 900_000;

/** Same pattern as regenInFlightRef — AppShell assigns, AiChatPage bumps. */
export const bumpForegroundIdleRef: { current: () => void } = {
  current: () => {},
};

/**
 * Foreground idle disposes when the engine stops producing, not when the turn
 * gets old: a turn that emitted a token within FOREGROUND_TOKEN_SILENCE_MS is
 * alive no matter how slow (the 2026-09-15 run lost a healthy thermal decode
 * to a wall-clock disposal), while a turn with no token past that bound — or
 * no token at all past FOREGROUND_STUCK_INFLIGHT_MS, the loadPrompt-hang case
 * from the 2026-09-16 run — is stalled no matter how young. The engine's own
 * KALSA_STALL watchdogs cannot cover this: their setTimeout/setInterval are
 * suspended while the Android host is paused. Quiet idle below still disposes.
 */
export function shouldRunForegroundIdleDispose(args: {
  engineReady: boolean;
  inFlight: boolean;
  idleMs: number;
  idleLimitMs?: number;
  /** Ms since the current generation's last token; undefined while the
   *  in-flight work has produced none (prefill) or is not the tracked
   *  stream (download, extract, model switch). */
  tokenSilenceMs?: number;
}): boolean {
  if (!args.engineReady) return false;
  if (args.inFlight) {
    if (args.tokenSilenceMs !== undefined) {
      return args.tokenSilenceMs >= FOREGROUND_TOKEN_SILENCE_MS;
    }
    return args.idleMs >= FOREGROUND_STUCK_INFLIGHT_MS;
  }
  return args.idleMs >= (args.idleLimitMs ?? FOREGROUND_IDLE_DISPOSE_MS);
}
