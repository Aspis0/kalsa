/**
 * User-chosen n_ctx for the engine (Settings → Context size).
 *
 * Same shape as governorRuntime's flag: a read/write pair that never throws,
 * and "unset" is a real value rather than a zero. While unset, the catalog
 * context and the high-RAM hybrid upgrade keep winning, so an install that
 * never opens this setting loads exactly what it loaded before it existed.
 * The stored size reaches the engine through resolveContextProfile's existing
 * `explicitNCtx` input, and gets there only if the active model can serve it.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

export const CONTEXT_SIZE_KEY = "kalsa.context.size";

/**
 * The offered ladder, smallest first. 8192 is contextProfile.DEFAULT_N_CTX and
 * the deviceTuning CTX_FLOOR (the product minimum), each step doubles from
 * there, and 102400 is the owner's 100k ceiling. Not imported from
 * contextProfile: this module stays a storage leaf, and the two constants move
 * together by intent, not by reference.
 */
export const CONTEXT_SIZE_OPTIONS = [8192, 16384, 32768, 65536, 102400] as const;

/** The stored choice, or null when the user never picked one. Never throws. */
export async function readUserContextSize(): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(CONTEXT_SIZE_KEY);
    if (raw == null) return null;
    const n = Number(String(raw).trim());
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null;
    return n;
  } catch {
    return null;
  }
}

/** Persists the choice; returns whether the write landed. Never throws. */
export async function writeUserContextSize(nCtx: number): Promise<boolean> {
  try {
    await AsyncStorage.setItem(CONTEXT_SIZE_KEY, String(Math.floor(nCtx)));
    return true;
  } catch (error) {
    console.warn(`Failed to persist ${CONTEXT_SIZE_KEY}`, error);
    return false;
  }
}

/**
 * Sizes offered for a model: the ladder up to `contextLength`, plus that
 * length itself when it sits above the ladder (LFM 131072, Qwen 262144).
 * A model shorter than the first rung gets only its own maximum — the list is
 * never allowed to offer more than the model can hold.
 */
export function contextSizeChoices(contextLength?: number | null): number[] {
  const max =
    typeof contextLength === "number" && Number.isFinite(contextLength) && contextLength > 0
      ? Math.floor(contextLength)
      : null;
  if (max === null) return [...CONTEXT_SIZE_OPTIONS];
  const choices: number[] = CONTEXT_SIZE_OPTIONS.filter((n) => n <= max);
  if (choices[choices.length - 1] !== max) choices.push(max);
  return choices;
}

export type ContextSizeOutcome =
  | { kind: "as-requested"; requested: number; loaded: number }
  | {
      kind: "phone-could-not-hold";
      requested: number;
      loaded: number;
      neededMiB: number;
      availableMiB: number | null;
    }
  | { kind: "model-max"; requested: number; loaded: number };

/**
 * What the memory budget did to the request, read off resolveContextBudget's
 * own outputs (ctxSource + memory) rather than recomputed here. `loaded` is
 * that resolver's n_ctx for this request, which is the context initEngine will
 * use; the UI says which of the three cases it is instead of showing the
 * request as if it had been honoured.
 */
export function contextSizeOutcome(input: {
  requested: number;
  loaded: number;
  /** resolveEngineTuningSync().context.ctxSource. */
  ctxSource: string;
  /** resolveEngineTuningSync().memory.nonEvictableMiB. */
  nonEvictableMiB: number;
  /** resolveEngineTuningSync().memory.availableMiB. */
  availableMiB: number | null;
}): ContextSizeOutcome {
  const { requested, loaded } = input;
  if (loaded >= requested) return { kind: "as-requested", requested, loaded };
  const memoryCut =
    input.ctxSource === "memory-budget" || input.ctxSource.startsWith("floor:");
  if (memoryCut) {
    return {
      kind: "phone-could-not-hold",
      requested,
      loaded,
      neededMiB: Math.round(input.nonEvictableMiB),
      availableMiB: input.availableMiB,
    };
  }
  // ctxSource "request" with a smaller n_ctx means the model's own
  // contextLength clamped it (resolveContextBudget clamps before the floor).
  return { kind: "model-max", requested, loaded };
}
