/**
 * Stage 1 changes no decision (DESIGN.md :385-387): the learned store writes
 * values nothing reads back yet, and the params the binding receives must stay
 * byte-identical. This is the guard that says so, on the real builder.
 */
// State-backed: this test's premise is a store that is actually full, which a
// getItem that always answers null can never produce. The factory runs at
// import time, so the map has to live inside it.
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
jest.mock("react-native", () => ({ NativeModules: {} }));
jest.mock("../../../modules/kalsa-thermal/src", () => ({
  addPlatformThermalListener: jest.fn(),
  getCurrentPlatformThermalState: jest.fn(async () => null),
  isPlatformThermalModuleAvailable: jest.fn(() => false),
}));
jest.mock("../deviceProfile", () => ({
  getCachedDeviceProfile: jest.fn(async () => ({
    modelName: "23127PN0CG",
    buildFingerprint: "kalsa/shiba:14/AP2A.1/1:user/release-keys",
  })),
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import { buildGovernorParams } from "../governorInputs";
import {
  learnedLogFields,
  learnedRecordFrom,
  learnedStoreKey,
  recordLearnedObservation,
} from "../governorLearned";
import type { GovernorObservationRow } from "../governorObservation";
import type { DeviceProfile } from "../deviceProfile";

const MIB = 1024 * 1024;
const SEEDS = { heat: { npu: 1.1, gpu: 3.2, cpu: 7.3 }, tps: { npu: 16, gpu: 21, cpu: 14.7 } };
const FP = {
  model: "lfm2.5-1.2b",
  device: "23127PN0CG",
  soc: "SM8650",
  build: "kalsa/shiba:14/AP2A.1/1:user/release-keys",
  pin: "abc123",
};

const phone = (over: Partial<DeviceProfile> = {}) =>
  ({
    modelName: "23127PN0CG",
    modelId: null,
    manufacturer: "Xiaomi",
    totalMemoryBytes: 12 * 1024 ** 3,
    availableMemoryBytes: 6 * 1024 ** 3,
    socModel: "SM8650",
    socManufacturer: null,
    buildFingerprint: FP.build,
    osName: "Android",
    ...over,
  }) as DeviceProfile;

const model = {
  sizeBytes: 1_200 * MIB,
  kvBytesPerToken: 1024,
  hybrid: true,
};

const memory = {
  availableMemoryBytes: 6 * 1024 ** 3,
  totalMemoryBytes: 12 * 1024 ** 3,
  contextTokens: 16384,
};

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

/** A row that teaches the store something on every axis. */
const learnedRow = (over: Partial<GovernorObservationRow> = {}): GovernorObservationRow => ({
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
  hl: 0.115,
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

const backing = (): Map<string, string> =>
  (AsyncStorage as unknown as { store: Map<string, string> }).store;

beforeEach(() => {
  backing().clear();
  jest.spyOn(console, "log").mockImplementation(() => undefined);
});

/** Absorb real rows through the module until the store is genuinely full, and
 *  return the record it left behind. */
const fillStore = async (rows: number) => {
  for (let i = 0; i < rows; i += 1) {
    await recordLearnedObservation(
      learnedRow({
        tok: [0, 160, 160 + 8 * i],
        us: [0, 8_000_000, 8_000_000 + 40_000 * i],
        win: [
          window(32, null, 0),
          window(64, 2, 0.1),
          window(96, 2, 0.1 + 0.0005 * i),
          window(128, 1, 0.105 + 0.0005 * i),
        ],
      }),
    );
  }
  const key = learnedStoreKey(FP);
  const raw = backing().get(key);
  expect(raw).toBeDefined();
  return { key, record: learnedRecordFrom(JSON.parse(raw as string), FP, SEEDS) };
};
afterEach(() => {
  jest.restoreAllMocks();
});

describe("the learned store reaches no decision", () => {
  it("leaves buildGovernorParams byte-identical once the store is full", async () => {
    const before = JSON.stringify(buildGovernorParams(model, phone(), memory));
    const { record } = await fillStore(15);
    // The premise, checked: the store really learned, so "unchanged" means
    // something. A store that never filled would pass this test vacuously.
    expect(record.heatRows).toBe(15);
    expect(record.heat.weight).toBeGreaterThan(1);
    expect(record.prefillTps.npu).not.toBeNull();
    expect(record.tps.gpu).not.toBe(SEEDS.tps.gpu);
    expect(JSON.stringify(buildGovernorParams(model, phone(), memory))).toBe(before);
  });

  it("sends no speed or heat param at all", () => {
    const params = buildGovernorParams(model, phone(), memory, false, undefined, {
      android: true,
      hasMmproj: false,
      htpArch: 75,
    });
    // Stage 2's params (decode_speed_*) do not exist yet; Stage 1 must not
    // pre-create them, because an absent key and a zero key differ to the
    // binding's parser.
    expect(Object.keys(params).filter((key) => key.startsWith("decode_speed"))).toEqual([]);
  });

  it("keeps every bench arm's params identical with a full store", async () => {
    // The arms differ from each other on purpose (force, repack, hop, guard,
    // SoC); what must not differ is an arm before the store learned anything
    // and the same arm after.
    const arms = () => [
      buildGovernorParams(model, phone(), memory),
      buildGovernorParams(model, phone(), memory, true),
      buildGovernorParams(model, phone(), memory, false, true, undefined, 32, 9),
      buildGovernorParams(model, phone({ socModel: "SM8550" }), memory),
    ];
    const before = arms().map((arm) => JSON.stringify(arm));
    await fillStore(15);
    expect(arms().map((arm) => JSON.stringify(arm))).toEqual(before);
  });

  it("reports the learned values only in the log line", async () => {
    const { record } = await fillStore(3);
    const fields = learnedLogFields(record, SEEDS, null, 0);
    // The speeds in the line are learned, not the shipped row's seeds.
    expect(fields.tps_gpu).not.toBe(SEEDS.tps.gpu);
    expect(fields.tps_gpu as number).toBeGreaterThan(19);
    expect(fields.prefill_tps_npu).toBe(205);
    expect(fields.breaker).toBe(0);
  });
});