/** Minimum time allowed for the first-token prefill watchdog. */
export const MIN_PREFILL_DEADLINE_MS = 90_000;

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
    return Math.max(0, input.minMs);
  }
  const promptTokens = Math.max(0, input.promptTokensEstimate);
  const minMs = Math.max(0, input.minMs);
  const estimatedSeconds = Math.ceil(promptTokens / input.prefillTokPerSec);
  return Math.max(minMs, 5 * estimatedSeconds * 1000);
}
