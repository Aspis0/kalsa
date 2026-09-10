/**
 * Generation watchdog thresholds. A 10 s token gap (0.05 tok/s is
 * pathological on either phone) is far beyond the Jelly's normal 3 tok/s
 * decode, or roughly 330 ms gaps. The rate rule requires at least 0.5 tok/s
 * after 30 s and catches sustained S23 failures such as 0.058 tok/s, even
 * when occasional tokens keep every gap below 10 s.
 */
export const GENERATION_STALL_GAP_MS = 10_000;
export const RATE_GRACE_MS = 30_000;
export const MIN_DECODE_TOK_PER_SEC = 0.5;

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

export function createStallWatchdog(input: {
  gapMs: number;
  now: () => number;
}): StallWatchdog {
  let firstTokenAt: number | null = null;
  let lastTokenAt: number | null = null;
  let tokenCount = 0;

  return {
    noteToken: () => {
      const now = input.now();
      firstTokenAt ??= now;
      lastTokenAt = now;
      tokenCount += 1;
    },
    check: () => {
      if (firstTokenAt === null || lastTokenAt === null) {
        return { stalled: false, reason: "gap", gapMs: 0, tokPerSec: 0 };
      }
      const now = input.now();
      const gapMs = Math.max(0, now - lastTokenAt);
      const elapsedMs = Math.max(0, now - firstTokenAt);
      const tokPerSec = elapsedMs > 0 ? (tokenCount / elapsedMs) * 1000 : 0;
      if (gapMs >= input.gapMs) {
        return { stalled: true, reason: "gap", gapMs, tokPerSec };
      }
      if (
        elapsedMs >= RATE_GRACE_MS &&
        tokPerSec < MIN_DECODE_TOK_PER_SEC
      ) {
        return { stalled: true, reason: "rate", gapMs, tokPerSec };
      }
      return { stalled: false, reason: "gap", gapMs, tokPerSec };
    },
    reset: () => {
      firstTokenAt = null;
      lastTokenAt = null;
      tokenCount = 0;
    },
  };
}
