import AsyncStorage from "@react-native-async-storage/async-storage";

export const BENCH_SAMPLING_KEY = "kalsa.bench.sampling";

export type BenchSamplingMode = "greedy" | undefined;

export type BenchSamplingParams = {
  n_predict?: number;
  n_probs?: number;
  temperature?: number;
  top_k?: number;
  top_p?: number;
  min_p?: number;
  penalty_last_n?: number;
  penalty_repeat?: number;
  penalty_freq?: number;
  penalty_present?: number;
  seed?: number;
};

export async function readBenchSampling(): Promise<BenchSamplingMode> {
  try {
    return (await AsyncStorage.getItem(BENCH_SAMPLING_KEY)) === "greedy"
      ? "greedy"
      : undefined;
  } catch {
    return undefined;
  }
}

export function applyBenchSampling<T extends BenchSamplingParams>(
  params: T,
  mode: BenchSamplingMode,
): T {
  if (mode !== "greedy") return params;
  Object.assign(params, {
    n_predict: Math.max(48, params.n_predict ?? 0),
    n_probs: 1,
    temperature: 0,
    top_k: 1,
    top_p: 1,
    min_p: 0,
    penalty_last_n: 0,
    penalty_repeat: 1,
    penalty_freq: 0,
    penalty_present: 0,
    seed: 42,
  });
  return params;
}
