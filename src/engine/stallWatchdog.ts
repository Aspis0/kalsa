/**
 * Generation watchdog thresholds.
 *
 * Gap 45 s: S23 T20B after a 1832-token prefix reuse paused ~10 s on the
 * first think token (`KALSA_STALL` gapMs=10143, tokens=1, tokPerSec=0.098).
 * The old 10 s gap aborted a live think start, not a hang.
 *
 * Decode rate is retained as telemetry over the trailing token window, but
 * it is not an abort condition. S23 T20D proved that slow first think tokens
 * after a large reused prefix can look like a rate stall while still live.
 *
 * A true hang still aborts through the prefill deadline before the first
 * token or a 45 s gap after it. Foreground idle is not a generation watchdog.
 */
export const GENERATION_STALL_GAP_MS = 45_000;
export const MIN_TOKENS_BEFORE_RATE = 8;
export const MIN_DECODE_TOK_PER_SEC = 0.2;
export const MIN_GAP_MS_BEFORE_RATE = 10_000;

export type StallReason = "gap" | "rate";

export type StallCheck = {
  stalled: boolean;
  reason: StallReason;
  gapMs: number;
  tokPerSec: number;
};

export type StallWatchdog = {
  noteToken: () => void;
  check: () => StallCheck;
  reset: () => void;
};

function trailingTokPerSec(tokenAt: readonly number[]): number {
  if (tokenAt.length < 2) return 0;
  const spanMs = tokenAt[tokenAt.length - 1]! - tokenAt[0]!;
  if (spanMs <= 0) return 0;
  return ((tokenAt.length - 1) / spanMs) * 1000;
}

export function createStallWatchdog(input: {
  gapMs: number;
  now: () => number;
}): StallWatchdog {
  const tokenAt: number[] = [];

  return {
    noteToken: () => {
      tokenAt.push(input.now());
      if (tokenAt.length > MIN_TOKENS_BEFORE_RATE) {
        tokenAt.shift();
      }
    },
    check: () => {
      if (tokenAt.length === 0) {
        return { stalled: false, reason: "gap", gapMs: 0, tokPerSec: 0 };
      }
      const now = input.now();
      const gapMs = Math.max(0, now - tokenAt[tokenAt.length - 1]!);
      const tokPerSec = trailingTokPerSec(tokenAt);
      if (gapMs >= input.gapMs) {
        return { stalled: true, reason: "gap", gapMs, tokPerSec };
      }
      // Rate stall removed: S23 7aabfe8 t1 n_common=5466=embd then
      // KALSA_STALL reason=rate gapMs=11377 tokens=8 tokPerSec=0.08.
      // Slow first think tokens after a 5k prefix are not a hang.
      // True hangs still hit the prefill deadline or the 45 s token gap.
      return { stalled: false, reason: "gap", gapMs, tokPerSec };
    },
    reset: () => {
      tokenAt.length = 0;
    },
  };
}
