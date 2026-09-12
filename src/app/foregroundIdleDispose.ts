/** Quiet foreground idle before save+dispose. Engine stays loaded after a turn. */
export const FOREGROUND_IDLE_DISPOSE_MS = 180_000;
/**
 * Jelly ~3.4 tok/s × 1024 n_predict ≈ 5 min; 15 min is headroom for long
 * replies, still stops overnight drain from a stuck generation.
 */
export const FOREGROUND_STUCK_INFLIGHT_MS = 900_000;

/** Same pattern as regenInFlightRef — AppShell assigns, AiChatPage bumps. */
export const bumpForegroundIdleRef: { current: () => void } = {
  current: () => {},
};

export function shouldRunForegroundIdleDispose(args: {
  engineReady: boolean;
  inFlight: boolean;
  idleMs: number;
  idleLimitMs?: number;
  stuckLimitMs?: number;
}): boolean {
  if (!args.engineReady) return false;
  const idleLimit = args.idleLimitMs ?? FOREGROUND_IDLE_DISPOSE_MS;
  const stuckLimit = args.stuckLimitMs ?? FOREGROUND_STUCK_INFLIGHT_MS;
  if (args.inFlight) return args.idleMs >= stuckLimit;
  return args.idleMs >= idleLimit;
}
