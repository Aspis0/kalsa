/**
 * Per-model EMA of measured prefill throughput (tokens/s).
 *
 * Turn telemetry feeds (promptN tokens / promptMs) per completed prefill;
 * document strategy reads the EMA to bound how many document tokens may ride
 * in a full_context prompt before the first word wait exceeds the budget.
 *
 * In-memory only. A model change simply starts a fresh EMA under the new id.
 */

/** Higher = more responsive to the latest sample; lower = smoother. */
const EMA_ALPHA = 0.3;
/**
 * Samples below this many prompt tokens are KV-cache hits / tiny prompts,
 * not a real full prefill — their ms/byte ratio would poison the EMA.
 */
const MIN_ACCEPTED_PROMPT_TOKENS = 64;

const tokPerSecByModel = new Map<string, number>();
const lastPromptTokensByModel = new Map<string, number>();

function isUsableSample(promptN: number, promptMs: number): boolean {
  return (
    Number.isFinite(promptN) &&
    Number.isFinite(promptMs) &&
    promptN >= MIN_ACCEPTED_PROMPT_TOKENS &&
    promptMs > 0
  );
}

/**
 * Record one completed prefill. Invalid samples (cache hits, unsynced
 * counters, missing timings) are ignored — defaults are 0 / -1.
 */
export function recordPrefillSample(
  modelId: string,
  promptN: number,
  promptMs: number,
): void {
  if (!modelId || !isUsableSample(promptN, promptMs)) return;
  const tokPerSec = (promptN / promptMs) * 1000;
  lastPromptTokensByModel.set(modelId, promptN);
  const prev = tokPerSecByModel.get(modelId);
  tokPerSecByModel.set(
    modelId,
    prev === undefined
      ? tokPerSec
      : EMA_ALPHA * tokPerSec + (1 - EMA_ALPHA) * prev,
  );
}

/** EMA tokens/s for a model, or null when no usable sample exists yet. */
export function getPrefillTokPerSec(modelId: string): number | null {
  return tokPerSecByModel.get(modelId) ?? null;
}

/** Last accepted native prompt size, including chat-template overhead. */
export function getLastPromptTokens(modelId: string): number | null {
  return lastPromptTokensByModel.get(modelId) ?? null;
}

/**
 * Max prompt tokens a full_context prefill may carry while staying within
 * maxWaitMs at the measured speed. Fallback when no sample has been recorded.
 */
export function prefillBudgetTokens(
  modelId: string,
  maxWaitMs: number,
  fallbackTokens: number,
): number {
  const tokPerSec = getPrefillTokPerSec(modelId);
  if (tokPerSec === null) return fallbackTokens;
  return Math.floor((tokPerSec * maxWaitMs) / 1000);
}

/** Test-only: wipe in-memory EMAs between test cases. */
export function __resetPrefillSpeedForTests(): void {
  tokPerSecByModel.clear();
  lastPromptTokensByModel.clear();
}
