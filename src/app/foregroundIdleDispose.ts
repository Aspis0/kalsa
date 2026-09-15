/** Quiet foreground idle before save+dispose. Engine stays loaded after a turn. */
export const FOREGROUND_IDLE_DISPOSE_MS = 180_000;

/** Same pattern as regenInFlightRef — AppShell assigns, AiChatPage bumps. */
export const bumpForegroundIdleRef: { current: () => void } = {
  current: () => {},
};

/**
 * Foreground idle never unloads while a send/native work is in flight, at
 * any age: a slow thermal decode is legitimate progress (S23 T20C run
 * 2026-09-15 lost turn 9 to a stuck-in-flight disposal while the stream was
 * healthy, KALSA_STALL=0). True stalls have their own prefill/decode
 * watchdogs; quiet idle below still disposes.
 */
export function shouldRunForegroundIdleDispose(args: {
  engineReady: boolean;
  inFlight: boolean;
  idleMs: number;
  idleLimitMs?: number;
}): boolean {
  if (!args.engineReady) return false;
  if (args.inFlight) return false;
  return args.idleMs >= (args.idleLimitMs ?? FOREGROUND_IDLE_DISPOSE_MS);
}
