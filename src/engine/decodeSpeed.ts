/** Per-model EMA of measured chat decode throughput (tokens/s). */

const EMA_ALPHA = 0.3;
const MIN_ACCEPTED_PREDICTED_TOKENS = 16;

const tokPerSecByModel = new Map<string, number>();

function isUsableSample(predictedN: number, predictedMs: number): boolean {
  return (
    Number.isFinite(predictedN) &&
    predictedN >= MIN_ACCEPTED_PREDICTED_TOKENS &&
    Number.isFinite(predictedMs) &&
    predictedMs > 0
  );
}

/** Record one accepted chat decode sample into the model's EMA. */
export function recordDecodeSample(
  modelId: string,
  predictedN: number,
  predictedMs: number,
): void {
  if (!modelId || !isUsableSample(predictedN, predictedMs)) return;
  const tokPerSec = (predictedN / predictedMs) * 1000;
  const previous = tokPerSecByModel.get(modelId);
  tokPerSecByModel.set(
    modelId,
    previous === undefined
      ? tokPerSec
      : EMA_ALPHA * tokPerSec + (1 - EMA_ALPHA) * previous,
  );
}

/** EMA tokens/s for a model, or null before a usable chat sample. */
export function getDecodeTokPerSec(modelId: string): number | null {
  return tokPerSecByModel.get(modelId) ?? null;
}

/** Test-only: wipe in-memory decode EMAs. */
export function __resetDecodeSpeedForTests(): void {
  tokPerSecByModel.clear();
}
