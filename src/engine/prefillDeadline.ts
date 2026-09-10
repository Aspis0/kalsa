/** Minimum time allowed for the first-token prefill watchdog. */
export const MIN_PREFILL_DEADLINE_MS = 90_000;

/**
 * Give prefill five times the measured full-prompt duration, rounded up to
 * whole seconds. This catches a prefill at least 5× slower than its EMA, not
 * ordinary thermal slowdown: a hot Jelly (EMA 17.8 tok/s cool, 9.4 tok/s at
 * 47 °C) took 225 s for 2112 tokens, while chars/4 gave 992 tokens and a 3×
 * deadline of 167 s would have falsely stalled it. The minimum prevents
 * short prompts from being treated as stalled by timer jitter.
 * A missing EMA leaves the prefill unwatched until a sample exists.
 */
export function prefillDeadlineMs(input: {
  promptTokensEstimate: number;
  prefillTokPerSec: number | null;
  minMs: number;
}): number | null {
  if (
    input.prefillTokPerSec === null ||
    !Number.isFinite(input.prefillTokPerSec) ||
    input.prefillTokPerSec <= 0
  ) {
    return null;
  }
  const promptTokens = Math.max(0, input.promptTokensEstimate);
  const minMs = Math.max(0, input.minMs);
  const estimatedSeconds = Math.ceil(promptTokens / input.prefillTokPerSec);
  return Math.max(minMs, 5 * estimatedSeconds * 1000);
}
