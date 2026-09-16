import { GENERATION_STALL_GAP_MS } from "../engine/stallWatchdog";

/** Quiet foreground idle before save+dispose. Engine stays loaded after a turn. */
export const FOREGROUND_IDLE_DISPOSE_MS = 180_000;

/**
 * Decode backstop, strictly looser than the primary it backs up: the engine
 * aborts a turn at GENERATION_STALL_GAP_MS of raw-token silence, so the app
 * disposes only after 3 full gap windows — it must be able to fire only when
 * the engine's watchdog demonstrably failed, never race (or beat) it.
 */
export const FOREGROUND_DECODE_SILENCE_MS = 3 * GENERATION_STALL_GAP_MS;

/** Same pattern as regenInFlightRef — AppShell assigns, AiChatPage bumps. */
export const bumpForegroundIdleRef: { current: () => void } = {
  current: () => {},
};

/**
 * Foreground idle disposal. Stall protection is the engine's job — the 45 s
 * raw-token gap abort and the prompt-scaled prefill deadline, both on the
 * native paused-activity timer. This net only backs them up: pre-first-token
 * turns are never app-disposed (a cold 5441-token prefill legitimately
 * exceeds 900 s, so no fixed bound may exist here), a decoding turn is
 * disposed only past FOREGROUND_DECODE_SILENCE_MS of RAW-token silence, and
 * quiet idle below still disposes.
 */
export function shouldRunForegroundIdleDispose(args: {
  engineReady: boolean;
  inFlight: boolean;
  idleMs: number;
  idleLimitMs?: number;
  /** Ms since this generation's last RAW native token; undefined while the
   *  turn has not decoded its first token yet. */
  tokenSilenceMs?: number;
}): boolean {
  if (!args.engineReady) return false;
  if (args.inFlight) {
    if (args.tokenSilenceMs === undefined) return false;
    return args.tokenSilenceMs >= FOREGROUND_DECODE_SILENCE_MS;
  }
  return args.idleMs >= (args.idleLimitMs ?? FOREGROUND_IDLE_DISPOSE_MS);
}
