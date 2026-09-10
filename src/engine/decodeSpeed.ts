/** Per-model EMA of measured chat decode throughput (tokens/s). */

const EMA_ALPHA = 0.3;
const MIN_ACCEPTED_PREDICTED_TOKENS = 16;
/**
 * A single short completed turn (e.g. "ciao" answered with thinking) can
 * decode far faster than sustained turns and spike the EMA over the extended
 * thinking threshold. Every usable sample is still folded into the EMA, but
 * the value is withheld until this many accepted samples have landed for the
 * model, so a one-off fast turn cannot unlock extended thinking by itself.
 */
export const MIN_SAMPLES_BEFORE_EMA = 3;

type DecodeEma = { tokPerSec: number; samples: number };

/**
 * In-memory only: a process restart resets the per-model sample count, so
 * thinking stays on the short budget until 3 accepted samples land again.
 * That cold-start withholding is intentional (owner rule: first measure →
 * short) and is deliberately not persisted.
 */
const emaByModel = new Map<string, DecodeEma>();

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
  const previous = emaByModel.get(modelId);
  emaByModel.set(modelId, {
    tokPerSec:
      previous === undefined
        ? tokPerSec
        : EMA_ALPHA * tokPerSec + (1 - EMA_ALPHA) * previous.tokPerSec,
    samples: (previous?.samples ?? 0) + 1,
  });
}

/**
 * EMA tokens/s for a model, or null until at least
 * `MIN_SAMPLES_BEFORE_EMA` usable chat samples have been recorded. The count
 * lives in the in-memory map above, so after a process restart this returns
 * null again and extended thinking stays withheld until 3 fresh samples.
 */
export function getDecodeTokPerSec(modelId: string): number | null {
  const ema = emaByModel.get(modelId);
  if (!ema || ema.samples < MIN_SAMPLES_BEFORE_EMA) return null;
  return ema.tokPerSec;
}

/** Test-only: wipe in-memory decode EMAs. */
export function __resetDecodeSpeedForTests(): void {
  emaByModel.clear();
}
