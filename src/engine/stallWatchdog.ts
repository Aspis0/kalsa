/**
 * Generation watchdog thresholds.
 *
 * Gap 45 s: S23 T20B after a 1832-token prefix reuse paused ~10 s on the
 * first think token (`KALSA_STALL` gapMs=10143, tokens=1, tokPerSec=0.098).
 * The old 10 s gap aborted a live think start, not a hang.
 *
 * Rate: trailing window of the last `MIN_TOKENS_BEFORE_RATE` timestamps,
 * not cumulative since firstTokenAt. Judge only after 8 tokens and only
 * when gapMs >= 10 s. S23 T20D aborted a live think at tokens=329
 * gapMs=1812 tokPerSec=0.166 (`reason=rate`) — 1.8 s between tokens is
 * not a hang. 0.2 tok/s is 5 s/token; a 0.058 tok/s crawl with ~9 s
 * gaps still fails the trailing rate.
 *
 * A true hang still aborts: no tokens → prefill deadline; after the first
 * token a 45 s gap; 15 min FOREGROUND_STUCK remains the inflight cap.
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
      // True hangs still hit the 45s gap (FOREGROUND_STUCK 15 min).
      return { stalled: false, reason: "gap", gapMs, tokPerSec };
    },
    reset: () => {
      tokenAt.length = 0;
    },
  };
}
