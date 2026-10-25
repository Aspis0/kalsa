/** Minimum time allowed for the first-token prefill watchdog. */
export const MIN_PREFILL_DEADLINE_MS = 180_000;
/** Cold-start (no EMA) assume at least this many prefill tok/s. */
export const NO_EMA_PREFILL_TOK_PER_SEC = 10;
/** Cap a missing-EMA deadline. 8k-token APK-upgrade heal (S23 a21746e
 * t1 text_tokens=7602 vs leftover KV 4780) needs ~760s at 10 tok/s. */
export const MAX_NO_EMA_PREFILL_DEADLINE_MS = 900_000;

/**
 * Give prefill five times the measured full-prompt duration, rounded up to
 * whole seconds. This catches a prefill at least 5× slower than its EMA, not
 * ordinary thermal slowdown: a hot Jelly (EMA 17.8 tok/s cool, 9.4 tok/s at
 * 47 °C) took 225 s for 2112 tokens, while chars/4 gave 992 tokens and a 3×
 * deadline of 167 s would have falsely stalled it. The minimum prevents
 * short prompts from being treated as stalled by timer jitter.
 * A missing EMA still arms the min deadline (90 s) so a cold process
 * cannot hang forever before token 1. Luna stall-trail audit 2026-09-13.
 */
export function prefillDeadlineMs(input: {
  promptTokensEstimate: number;
  prefillTokPerSec: number | null;
  minMs: number;
}): number {
  if (
    input.prefillTokPerSec === null ||
    !Number.isFinite(input.prefillTokPerSec) ||
    input.prefillTokPerSec <= 0
  ) {
    const promptTokens = Math.max(0, input.promptTokensEstimate);
    const scaled = Math.ceil(promptTokens / NO_EMA_PREFILL_TOK_PER_SEC) * 1000;
    return Math.min(
      MAX_NO_EMA_PREFILL_DEADLINE_MS,
      Math.max(input.minMs, scaled),
    );
  }
  const promptTokens = Math.max(0, input.promptTokensEstimate);
  const minMs = Math.max(0, input.minMs);
  const estimatedSeconds = Math.ceil(promptTokens / input.prefillTokPerSec);
  return Math.max(minMs, 5 * estimatedSeconds * 1000);
}
