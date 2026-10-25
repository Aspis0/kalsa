import AsyncStorage from "@react-native-async-storage/async-storage";

export const BENCH_SAMPLING_KEY = "kalsa.bench.sampling";
export const BENCH_PROBS_KEY = "kalsa.bench.probs";
export const BENCH_FORCE_IDS_KEY = "kalsa.bench.force_ids";

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

export type BenchOracleParams = {
  bench_raw_probs?: number;
  bench_force_ids?: number[];
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

export async function readBenchOracleParams(): Promise<BenchOracleParams> {
  try {
    const [probs, forceIds] = await Promise.all([
      AsyncStorage.getItem(BENCH_PROBS_KEY),
      AsyncStorage.getItem(BENCH_FORCE_IDS_KEY),
    ]);
    const result: BenchOracleParams = {};
    if (probs === "1") result.bench_raw_probs = 5;
    if (forceIds !== null) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(forceIds);
      } catch {
        parsed = undefined;
      }
      if (
        Array.isArray(parsed) &&
        parsed.every((id) => Number.isSafeInteger(id))
      ) {
        result.bench_force_ids = parsed;
      } else {
        console.warn(`[benchSampling] ignoring malformed ${BENCH_FORCE_IDS_KEY}`);
      }
    }
    return result;
  } catch {
    return {};
  }
}

export function applyBenchSampling<T extends BenchSamplingParams>(
  params: T,
  mode: BenchSamplingMode,
  oracle: BenchOracleParams = {},
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
    ...(oracle.bench_raw_probs !== undefined
      ? { bench_raw_probs: oracle.bench_raw_probs }
      : {}),
    ...(oracle.bench_force_ids !== undefined
      ? { bench_force_ids: oracle.bench_force_ids }
      : {}),
  });
  return params;
}
