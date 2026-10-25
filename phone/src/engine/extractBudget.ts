export const EXTRACT_MEMORY_MIN_TIMEOUT_MS = 20_000;
const EXTRACT_MEMORY_MAX_TIMEOUT_MS = 120_000;

export type ExtractSpeed = number | null;

/**
 * Budget an isolated memory extraction from measured prefill/decode speed.
 * If either EMA is unavailable, keep the historical 20 s fail-closed budget.
 */
export function extractTimeoutMs(input: {
  decodeTokPerSec: ExtractSpeed;
  nPredict: number;
  promptTokensEstimate: number;
  prefillTokPerSec: ExtractSpeed;
}): number {
  const {
    decodeTokPerSec,
    nPredict,
    promptTokensEstimate,
    prefillTokPerSec,
  } = input;
  if (
    !(
      decodeTokPerSec !== null &&
      Number.isFinite(decodeTokPerSec) &&
      decodeTokPerSec > 0
    ) ||
    !(
      prefillTokPerSec !== null &&
      Number.isFinite(prefillTokPerSec) &&
      prefillTokPerSec > 0
    )
  ) {
    return EXTRACT_MEMORY_MIN_TIMEOUT_MS;
  }
  const estimatedMs =
    (Math.max(0, promptTokensEstimate) / prefillTokPerSec) * 1000 +
    (Math.max(0, nPredict) / decodeTokPerSec) * 1000;
  return Math.min(
    EXTRACT_MEMORY_MAX_TIMEOUT_MS,
    Math.max(EXTRACT_MEMORY_MIN_TIMEOUT_MS, estimatedMs),
  );
}
