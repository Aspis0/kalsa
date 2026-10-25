jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: { getItem: jest.fn() },
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  applyBenchSampling,
  BENCH_FORCE_IDS_KEY,
  BENCH_PROBS_KEY,
  BENCH_SAMPLING_KEY,
  readBenchOracleParams,
  readBenchSampling,
} from "./benchSampling";

describe("readBenchSampling", () => {
  beforeEach(() => {
    (AsyncStorage.getItem as jest.Mock).mockReset();
  });

  it.each([
    [null, undefined],
    ["garbage", undefined],
    ["greedy", "greedy"],
  ])("maps %j", async (stored, expected) => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(stored);
    await expect(readBenchSampling()).resolves.toBe(expected);
    expect(AsyncStorage.getItem).toHaveBeenCalledWith(BENCH_SAMPLING_KEY);
  });
});

describe("applyBenchSampling", () => {
  it("maps greedy mode to the exact bench sampler", () => {
    expect(
      applyBenchSampling(
        {
          n_predict: 16,
          n_probs: 0,
          temperature: 0.7,
          top_k: 40,
          top_p: 0.95,
          min_p: 0.05,
          penalty_last_n: 64,
          penalty_repeat: 1.1,
          penalty_freq: 0.2,
          penalty_present: 0.3,
          seed: 7,
        },
        "greedy",
      ),
    ).toEqual({
      n_predict: 48,
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
  });

  it("leaves non-greedy production sampling untouched", () => {
    const params = { temperature: 0.7, top_k: 40, top_p: 0.95, n_predict: 1024 };
    const before = JSON.stringify(params);
    expect(applyBenchSampling(params, undefined)).toBe(params);
    expect(JSON.stringify(params)).toBe(before);
  });

  it("passes oracle params only through greedy mode", () => {
    expect(
      applyBenchSampling(
        { n_predict: 32 },
        "greedy",
        { bench_raw_probs: 5, bench_force_ids: [1, 2] },
      ),
    ).toMatchObject({
      bench_raw_probs: 5,
      bench_force_ids: [1, 2],
    });
    const params = { n_predict: 32 };
    expect(
      applyBenchSampling(params, undefined, {
        bench_raw_probs: 5,
        bench_force_ids: [1, 2],
      }),
    ).toBe(params);
    expect(params).not.toHaveProperty("bench_raw_probs");
  });
});

describe("readBenchOracleParams", () => {
  beforeEach(() => {
    (AsyncStorage.getItem as jest.Mock).mockReset();
  });

  it("maps the bench keys", async () => {
    (AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) =>
      key === BENCH_PROBS_KEY ? "1" : key === BENCH_FORCE_IDS_KEY ? "[7, 8]" : null,
    );
    await expect(readBenchOracleParams()).resolves.toEqual({
      bench_raw_probs: 5,
      bench_force_ids: [7, 8],
    });
  });

  it("omits absent params", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    await expect(readBenchOracleParams()).resolves.toEqual({});
  });

  it("warns and ignores malformed force ids", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    (AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) =>
      key === BENCH_FORCE_IDS_KEY ? "[7, \"bad\"]" : null,
    );
    await expect(readBenchOracleParams()).resolves.toEqual({});
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(BENCH_FORCE_IDS_KEY),
    );
    warn.mockRestore();
  });
});
