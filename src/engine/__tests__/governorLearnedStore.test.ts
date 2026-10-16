/**
 * The learned store (governorLearned.ts): the fingerprint it keys on, the
 * round trip through AsyncStorage, the breaker trip's 6 h hold, and the
 * KALSA_GOVERNOR_LEARNED line it writes after every absorbed row.
 */
// State-backed so a test can read back what a later call wrote; the factory
// runs at import time, so the map has to live inside it.
jest.mock("@react-native-async-storage/async-storage", () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      store,
      getItem: jest.fn(async (key: string) => store.get(key) ?? null),
      setItem: jest.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
    },
  };
});
jest.mock("../deviceProfile", () => ({
  getCachedDeviceProfile: jest.fn(async () => ({
    modelName: "23127PN0CG",
    buildFingerprint: "kalsa/shiba:14/AP2A.1/1:user/release-keys",
  })),
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import { finalizeLine } from "../../logReport/normalize";
import { getCachedDeviceProfile } from "../deviceProfile";
import type { GovernorObservationRow } from "../governorObservation";
import {
  BREAKER_HOLD_MS,
  BREAKER_STORE_KEY,
  breakerHoldMsLeft,
  breakerLatched,
  heatStateFrom,
  learnedLogFields,
  learnedRecordFrom,
  learnedStoreKey,
  LEARNED_STORE_PREFIX,
  noteSpeedBreakerTrip,
  readSpeedBreakerTrip,
  recordLearnedObservation,
  shippedLearnedSeeds,
  type LearnedFingerprint,
} from "../governorLearned";

const getItem = AsyncStorage.getItem as jest.Mock;
const setItem = AsyncStorage.setItem as jest.Mock;

const FP: LearnedFingerprint = {
  model: "lfm2.5-1.2b",
  device: "23127PN0CG",
  soc: "SM8650",
  build: "kalsa/shiba:14/AP2A.1/1:user/release-keys",
  pin: "abc123",
};
const SEEDS = { heat: { npu: 1.1, gpu: 3.2, cpu: 7.3 }, tps: { npu: 16, gpu: 21, cpu: 14.7 } };

const window = (tokens: number, leg: number | null, headroom: number): Array<number | null> => [
  tokens,
  leg,
  headroom,
  0,
  0,
  0,
  null,
  null,
  null,
  null,
  null,
  null,
  1,
];

const row = (over: Partial<GovernorObservationRow> = {}): GovernorObservationRow => ({
  v: 1,
  t: "7",
  round: 1,
  attempt: 1,
  gap: 0,
  fp: { model: FP.model, soc: FP.soc, pin: FP.pin },
  first_row: 0,
  state: "FAST",
  src: "battery",
  status: 0,
  batt: 320,
  level: 80,
  plugged: 0,
  prompt_n: 512,
  pred_n: 160,
  pred_ms: 8000,
  pps: 20,
  engine_prefill: "GPU",
  prefill_ms: 2500,
  prefill_dev: ["HTP0"],
  wall: [1000, 61000],
  first: window(32, null, 0),
  bsys: [0, null, 0, null],
  hl: 0.12,
  duty: 1,
  paced: [0, 0],
  tok: [0, 0, 160],
  us: [0, 0, 8_000_000],
  hops: 4,
  rule: "heat_rank",
  trips: Array<number | null>(6).fill(null),
  win: [window(32, null, 0), window(64, 2, 0.1), window(96, 2, 0.11), window(128, 2, 0.115)],
  win_ovf: 0,
  ...over,
});

/** The LAST write to a key: a second absorb overwrites the first. */
const storedAt = (key: string): unknown => {
  const calls = setItem.mock.calls.filter(([name]) => name === key);
  const call = calls[calls.length - 1];
  return call === undefined ? null : JSON.parse(call[1] as string);
};

const backing = (): Map<string, string> =>
  (AsyncStorage as unknown as { store: Map<string, string> }).store;

beforeEach(() => {
  backing().clear();
  getItem.mockClear();
  setItem.mockClear();
  jest.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the shipped device rows", () => {
  it("answers for the two phones the binding's legs table carries", () => {
    expect(shippedLearnedSeeds("SM8650")?.heat).toEqual({ npu: 1.1, gpu: 3.2, cpu: 7.3 });
    expect(shippedLearnedSeeds("sm8550")?.tps).toEqual({ npu: 17.1, gpu: 15, cpu: 13 });
  });

  it("answers null for an SoC with no row, so the store learns nothing", () => {
    expect(shippedLearnedSeeds("SM8850")).toBeNull();
    expect(shippedLearnedSeeds("")).toBeNull();
  });
});

describe("the fingerprint key", () => {
  it("separates a phone, a build and a binding pin", () => {
    const base = learnedStoreKey(FP);
    expect(base.startsWith(`${LEARNED_STORE_PREFIX}:`)).toBe(true);
    expect(base).toContain(FP.build);
    expect(learnedStoreKey({ ...FP, build: "other" })).not.toBe(base);
    expect(learnedStoreKey({ ...FP, pin: "def456" })).not.toBe(base);
    expect(learnedStoreKey({ ...FP, soc: "SM8550" })).not.toBe(base);
    // Two models on one phone never share a fit.
    expect(learnedStoreKey({ ...FP, model: "lfm2.5-2.6b" })).not.toBe(base);
  });
});

describe("round trip", () => {
  it("writes what it read back", async () => {
    await recordLearnedObservation(row());
    const saved = storedAt(learnedStoreKey(FP)) as Record<string, unknown>;
    const rebuilt = learnedRecordFrom(saved, FP, SEEDS);
    // The NPU leg ran 160 tokens in 8.0 s: 20 tok/s against a 16 seed.
    expect(rebuilt.tps.npu).toBeCloseTo(16 + 0.25 * (20 - 16), 10);
    expect(rebuilt.prefillTps.npu).toBeCloseTo((512 / 2500) * 1000, 10);
    expect(rebuilt.prefillTps.gpu).toBeNull();
    expect(rebuilt.heatRows).toBe(1);
    expect(rebuilt.heat.weight).toBeCloseTo(1, 10);
    expect(rebuilt.v).toBe(1);
  });

  it("carries a learned fit across a fresh record", async () => {
    await recordLearnedObservation(row());
    const saved = storedAt(learnedStoreKey(FP));
    // A second process reads the same key: the fit must come back whole.
    backing().set(learnedStoreKey(FP), JSON.stringify(saved));
    await recordLearnedObservation(row({ tok: [0, 0, 320], us: [0, 0, 16_000_000] }));
    const rebuilt = learnedRecordFrom(storedAt(learnedStoreKey(FP)), FP, SEEDS);
    expect(rebuilt.heatRows).toBe(2);
    expect(rebuilt.heat.weight).toBeCloseTo(0.95 + 1, 10);
    expect(rebuilt.tps.npu).toBeCloseTo(16 + 0.25 * (20 - 16) * 1.75, 10);
  });

  it("learns nothing on a phone with no shipped row", async () => {
    await recordLearnedObservation(row({ fp: { model: "x", soc: "SM8850", pin: "abc123" } }));
    expect(setItem).not.toHaveBeenCalled();
  });

  it("learns nothing without a build fingerprint", async () => {
    (getCachedDeviceProfile as jest.Mock).mockResolvedValueOnce({
      modelName: "23127PN0CG",
      buildFingerprint: null,
    });
    await recordLearnedObservation(row());
    expect(setItem).not.toHaveBeenCalled();
  });

  it("survives a damaged store instead of failing the turn", async () => {
    getItem.mockResolvedValueOnce("not json" as never);
    await expect(recordLearnedObservation(row())).resolves.toBeUndefined();
    expect(setItem).toHaveBeenCalled();
  });

  it("starts over on a record from another shape version", async () => {
    // A v that no longer matches means the stored fields no longer mean what
    // this code assumes, so nothing is carried over.
    getItem.mockResolvedValueOnce(
      JSON.stringify({
        v: 0,
        tps: { cpu: 1, gpu: 2, npu: 3 },
        heatRows: 99,
        heat: { gram: [], rhs: [], weight: 5, rss: 5 },
      }) as never,
    );
    await recordLearnedObservation(row());
    const rebuilt = learnedRecordFrom(storedAt(learnedStoreKey(FP)), FP, SEEDS);
    expect(rebuilt.heatRows).toBe(1);
    expect(rebuilt.tps.gpu).toBe(SEEDS.tps.gpu);
    expect(rebuilt.heat.weight).toBeCloseTo(1, 10);
  });

  it("survives a failing write", async () => {
    setItem.mockRejectedValueOnce(new Error("disk full"));
    await expect(recordLearnedObservation(row())).resolves.toBeUndefined();
  });

  it("rebuilds a fit whose stored matrix is not the shape it must be", () => {
    const short = heatStateFrom({ gram: [[1]], rhs: [1], weight: 3 });
    expect(short.weight).toBe(0);
    expect(short.gram).toHaveLength(7);
    const poisoned = heatStateFrom({
      gram: Array.from({ length: 7 }, () => Array.from({ length: 7 }, () => 1)),
      rhs: Array<number>(7).fill(0),
      weight: 3,
      rss: 1,
    });
    poisoned.gram[3][3] = Number.NaN;
    expect(heatStateFrom(poisoned).weight).toBe(0);
    const nonFinite = heatStateFrom({
      gram: Array.from({ length: 7 }, () =>
        Array.from({ length: 7 }, () => Number.POSITIVE_INFINITY),
      ),
      rhs: Array<number>(7).fill(0),
      weight: 3,
      rss: 1,
    });
    expect(nonFinite.weight).toBe(0);
  });
});

describe("the KALSA_GOVERNOR_LEARNED line", () => {
  const logged = (): Record<string, unknown> => {
    const line = (console.log as jest.Mock).mock.calls
      .map(([text]) => String(text))
      .find((text) => text.startsWith("KALSA_GOVERNOR_LEARNED "));
    expect(line).toBeDefined();
    return JSON.parse((line as string).slice("KALSA_GOVERNOR_LEARNED ".length));
  };

  it("carries the seeded prior exactly while nothing has been fitted", () => {
    // With no accepted row the fit reports the shipped row's own uncertainty,
    // so the ucb is DESIGN 5.6's seed x 1.25 and the background is its 0.5.
    const fields = learnedLogFields(learnedRecordFrom(null, FP, SEEDS), SEEDS, null, 0);
    // Three significant digits: 1.375 C/1k reads 1.38, 9.125 reads 9.13.
    expect(fields.heat_npu).toBe(1.38);
    expect(fields.heat_gpu).toBe(4);
    expect(fields.heat_cpu).toBe(9.13);
    expect(fields.heat_bg).toBe(0.5);
    expect(fields.heat_sigma).toBe(0);
    expect(fields.heat_rows).toBe(0);
    expect(fields.breaker).toBe(0);
    expect(fields.breaker_hold_ms).toBeNull();
  });

  it("carries the learned numbers and no strings", async () => {
    await recordLearnedObservation(row());
    const fields = logged();
    expect(fields.tps_npu).toBe(17);
    expect(fields.prefill_tps_npu).toBe(205);
    expect(fields.prefill_tps_gpu).toBeNull();
    expect(fields.heat_rows).toBe(1);
    expect(fields.heat_rejects).toBe(0);
    // One accepted row moves the fit off the seeded prior and tightens its sd,
    // so the ucb drops inside the 0.75-3 clamp of the seed.
    expect(fields.heat_npu).toBeLessThan(1.1 * 1.25);
    expect(fields.heat_npu).toBeGreaterThan(1.1 * 0.75);
    // The row's own residual: h 0.1 -> 0.115 is y = 30 x 0.015 = 0.45 C,
    // against a prior that predicts 1.1 C/1k x 0.064k = 0.0704 C.
    expect(fields.heat_sigma).toBe(Number((0.45 - 1.1 * 0.064).toPrecision(3)));
    expect(fields.breaker).toBe(0);
    expect(fields.breaker_hold_ms).toBeNull();
    for (const value of Object.values(fields)) {
      expect(typeof value === "number" || value === null).toBe(true);
    }
  });

  it("counts a rejected fit row instead of learning from it", async () => {
    // h_last 0.2 against a wake of 0.1 is a 3.0 C rise, far outside the 1.0 C
    // band the empty fit allows.
    await recordLearnedObservation(
      row({
        win: [window(32, null, 0), window(64, 2, 0.1), window(96, 2, 0.2)],
        tok: [0, 0, 0],
        us: [0, 0, 0],
        prompt_n: 10,
        prefill_ms: null,
      }),
    );
    const fields = logged();
    expect(fields.heat_rows).toBe(0);
    expect(fields.heat_rejects).toBe(1);
  });

  it("survives finalizeLine with every field intact", async () => {
    // The report path clips any line past 300 chars, so this asserts the REAL
    // payload (rounded doubles from a fitted record) survives the trip.
    for (let i = 0; i < 15; i += 1) await recordLearnedObservation(row());
    const record = learnedRecordFrom(storedAt(learnedStoreKey(FP)), FP, SEEDS);
    const fields = learnedLogFields(record, SEEDS, { atMs: Date.now() - 60_000 }, Date.now());
    const line = `KALSA_GOVERNOR_LEARNED ${JSON.stringify(fields)}`;
    expect(line.length).toBeLessThanOrEqual(300);
    const finalized = finalizeLine(line);
    expect(finalized).not.toBeNull();
    const stamped = finalized as string;
    // From the payload's first brace: a clip mid-object fails to parse, which
    // is the failure this test exists to catch.
    const survived = JSON.parse(stamped.slice(stamped.indexOf("{"))) as Record<string, unknown>;
    expect(Object.keys(survived).sort()).toEqual(Object.keys(fields).sort());
  });

  it("reports the breaker hold while one runs", () => {
    const nowMs = 1_000_000;
    const trip = { atMs: nowMs - 60_000 };
    const record = learnedRecordFrom(null, FP, SEEDS);
    const fields = learnedLogFields(record, SEEDS, trip, nowMs);
    expect(fields.breaker).toBe(1);
    expect(fields.breaker_hold_ms).toBe(BREAKER_HOLD_MS - 60_000);
  });
});

describe("the breaker latch", () => {
  it("holds inside the window and releases outside it", () => {
    const at = 1_000_000;
    expect(breakerLatched({ atMs: at }, at)).toBe(true);
    expect(breakerLatched({ atMs: at }, at + BREAKER_HOLD_MS - 1)).toBe(true);
    expect(breakerLatched({ atMs: at }, at + BREAKER_HOLD_MS)).toBe(false);
    expect(breakerHoldMsLeft({ atMs: at }, at + BREAKER_HOLD_MS)).toBeNull();
    expect(breakerHoldMsLeft(null, at)).toBeNull();
    expect(breakerLatched(null, at)).toBe(false);
  });

  it("persists a trip and reads it back", async () => {
    await noteSpeedBreakerTrip(true);
    const call = setItem.mock.calls.find(([key]) => key === BREAKER_STORE_KEY);
    expect(call).toBeDefined();
    backing().set(BREAKER_STORE_KEY, call?.[1] as string);
    const trip = await readSpeedBreakerTrip();
    expect(trip).not.toBeNull();
    expect(breakerLatched(trip, Date.now())).toBe(true);
  });

  it("writes nothing for a completion that did not trip", async () => {
    await noteSpeedBreakerTrip(false);
    expect(setItem).not.toHaveBeenCalled();
    backing().set(BREAKER_STORE_KEY, "{ broken");
    expect(await readSpeedBreakerTrip()).toBeNull();
  });

  it("never clears a trip early", async () => {
    await noteSpeedBreakerTrip(true);
    setItem.mockClear();
    await noteSpeedBreakerTrip(false);
    expect(setItem).not.toHaveBeenCalled();
  });
});