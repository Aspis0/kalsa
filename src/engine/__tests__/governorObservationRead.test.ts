/**
 * The Stage 0 observation read (governorObservationRead.ts): the baseline
 * generation — a read that was in flight when the baseline reset (engine
 * teardown, cache clear) must neither log a row nor seed the next engine's
 * baseline — plus the plain read path.
 */
import type { GovernorObservationRow } from "../governorObservation";
import {
  readGovernorObservationRow,
  resetObservationBaseline,
} from "../governorObservationRead";
import type { GovernorObservationStats } from "../governorObservation";

jest.mock("../deviceProfile", () => ({
  getCachedDeviceProfile: async () => ({ socModel: "SM8550" }),
}));

const stats = (over: Partial<GovernorObservationStats> = {}): GovernorObservationStats =>
  ({
    decode_hops: 1,
    decode_tokens_cpu: 0,
    decode_tokens_npu: 96,
    decode_tokens_gpu: 0,
    decode_us_cpu: 0,
    decode_us_npu: 6_000_000,
    decode_us_gpu: 0,
    decode_paced_ms: 0,
    decode_paced_tokens: 0,
    decode_pacing_duty_last: 1,
    decode_pacing_headroom_last: null,
    decode_hop_rule: null,
    decode_first_step_ms: 1000,
    decode_last_step_ms: 7000,
    decode_first_sample: Array<number | null>(13).fill(null),
    decode_batt_sysfs: [0, null, 0, null],
    decode_zone_trips: Array<number | null>(6).fill(null),
    decode_window_samples: [],
    decode_window_samples_overflow: false,
    thermal_state: "FAST",
    state_source: "battery",
    platform_thermal_status: -1,
    ...over,
  }) as GovernorObservationStats;

const args = (engine: { getGovernorStats: () => Promise<unknown> }) =>
  ({
    engine: engine as never,
    signal: undefined,
    governorActive: true,
    thermo: { batt_temp_tenths_c: 301, batt_level_pct: 88, plugged: false },
    model: "lfm2.5-1.2b",
    turnId: "42",
    round: 1,
    attempt: 1,
    completion: { prompt_n: 512, predicted_n: 96 },
  }) as Parameters<typeof readGovernorObservationRow>[0];

const readAll = async (engine: { getGovernorStats: () => Promise<unknown> }) =>
  (await readGovernorObservationRow(args(engine))) as GovernorObservationRow | null;

beforeEach(() => {
  resetObservationBaseline();
});

test("a normal read builds the row and seeds the baseline", async () => {
  const row = await readAll({ getGovernorStats: async () => stats() });
  expect(row).toMatchObject({ t: "42", first_row: 1, gap: 0, tok: [0, 0, 96] });
  // The second read is a delta row against the seeded baseline.
  const second = await readAll({
    getGovernorStats: async () => stats({ decode_tokens_npu: 192 }),
  });
  expect(second).toMatchObject({ first_row: 0, gap: 0, tok: [0, 0, 96] });
});

test("a read resolving after a reset writes no row and leaves the baseline empty", async () => {
  let resolveStats: ((value: GovernorObservationStats) => void) | undefined;
  const lateEngine = {
    getGovernorStats: () =>
      new Promise<GovernorObservationStats>((resolve) => {
        resolveStats = resolve;
      }),
  };
  const late = readAll(lateEngine);
  // Teardown (or a cache clear) lands while the old engine's read is out.
  resetObservationBaseline();
  resolveStats?.(stats({ decode_tokens_npu: 500 }));
  await expect(late).resolves.toBeNull();
  // The next engine's first read is a clean first row carrying gap:1 (its
  // predecessor's read was skipped) — 500 never seeded anything.
  const next = await readAll({ getGovernorStats: async () => stats() });
  expect(next).toMatchObject({ first_row: 1, gap: 1, tok: [0, 0, 96] });
});

test("an inactive governor reads nothing", async () => {
  const row = await readGovernorObservationRow({ ...args({ getGovernorStats: async () => stats() }), governorActive: false });
  expect(row).toBeNull();
});
