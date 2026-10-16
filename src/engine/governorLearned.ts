/**
 * The learned store (learning-governor DESIGN.md 5.5-5.6, Stage 1): what this
 * phone has learned about its own legs, keyed by the fingerprint that makes a
 * learned value mean anything (Build.MODEL + SoC + Build.FINGERPRINT + the
 * binding pin), plus the speed breaker's persisted trip.
 *
 * App-only and shadow: this writes learned values and logs them; nothing reads
 * them into a decision until Stage 2. Persisted in AsyncStorage (app private),
 * serialized on one chain so two completions cannot clobber each other.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getCachedDeviceProfile } from "./deviceProfile";
import type { GovernorObservationRow } from "./governorObservation";
import { learnedInputsFromRow } from "./governorLearnedRow";
import {
  backgroundUcb,
  emptyHeatFit,
  ewmaSpeed,
  heatPrior,
  HEAT_COLUMNS,
  HEAT_LEG_COLUMN,
  HEAT_WALL_COLUMN,
  LEGS,
  legHeatUcb,
  solveHeat,
  updateHeat,
  type HeatFitState,
  type Leg,
} from "./governorLearnedFit";

export const LEARNED_STORE_PREFIX = "kalsa.governor.learned.v1";
/** DESIGN 5.5: the trip outlives the policy, which is rebuilt at every load. */
export const BREAKER_STORE_KEY = "kalsa.governor.speedBreaker.v1";
/** OPEN 9's starting value: a trip holds the speed pass off for 6 h. */
export const BREAKER_HOLD_MS = 6 * 60 * 60 * 1000;

/**
 * The shipped device rows, mirrored from the binding's legs table
 * (rn-legs-table.cpp k_rows): heat in skin C per 1k tokens per leg, plus the
 * decode tok/s seeds DESIGN 5.6 quotes per phone. An SoC with no row learns
 * nothing — the design's "no row = off", one step earlier.
 */
const SHIPPED_ROWS: Record<
  string,
  { heat: Record<Leg, number>; tps: Record<Leg, number> }
> = {
  // S23: heat 2.8/3.2/4.7 (rule v3 round 4), speed 17.1/15.0/13.0.
  SM8550: {
    heat: { npu: 2.8, gpu: 3.2, cpu: 4.7 },
    tps: { npu: 17.1, gpu: 15.0, cpu: 13.0 },
  },
  // Xiaomi 14: heat 1.1/3.2/7.3 (cells 75/76), speed 16.0/21.0/14.7.
  SM8650: {
    heat: { npu: 1.1, gpu: 3.2, cpu: 7.3 },
    tps: { npu: 16.0, gpu: 21.0, cpu: 14.7 },
  },
};

export type LearnedSeeds = { heat: Record<Leg, number>; tps: Record<Leg, number> };

/** The shipped row for this SoC, or null when the phone has none. */
export function shippedLearnedSeeds(soc: string): LearnedSeeds | null {
  return SHIPPED_ROWS[soc.toUpperCase()] ?? null;
}

export type LearnedFingerprint = {
  /** The model file's catalog id — learned heat per token is per model, so
   *  two models on one phone must not share a fit (the observation row's
   *  fp.model). */
  model: string;
  /** Build.MODEL, the device model (expo-device's modelName on Android).
   *  DESIGN 5.6 names this component of the key. */
  device: string;
  /** Build.SOC_MODEL. */
  soc: string;
  /** Build.FINGERPRINT: an OTA or a firmware change invalidates the row. */
  build: string;
  /** The binding commit the observations were recorded against. */
  pin: string;
};

export const learnedStoreKey = (fp: LearnedFingerprint): string =>
  `${LEARNED_STORE_PREFIX}:${fp.model}|${fp.device}|${fp.soc}|${fp.build}|${fp.pin}`;

export type LearnedRecord = {
  /** Shape version, read on load: anything else starts the store over rather
   *  than being read as v1. */
  v: 1;
  fp: LearnedFingerprint;
  /** Per-leg decode speed in tok/s, EWMA over completions, seeded by the row. */
  tps: Record<Leg, number>;
  /** Per-leg prefill speed in tok/s; null until a completion prices it — no
   *  shipped seed exists for prefill. */
  prefillTps: Record<Leg, number | null>;
  heat: HeatFitState;
  heatRows: number;
  heatRejects: number;
};

export type BreakerTrip = { atMs: number } | null;

/** How much of the hold is left, or null when no trip holds it. */
export function breakerHoldMsLeft(trip: BreakerTrip, nowMs: number): number | null {
  if (trip === null) return null;
  const left = BREAKER_HOLD_MS - (nowMs - trip.atMs);
  return left > 0 ? left : null;
}

/** DESIGN 5.5: while the trip holds, the engine is sent a 0 lookahead. */
export function breakerLatched(trip: BreakerTrip, nowMs: number): boolean {
  return breakerHoldMsLeft(trip, nowMs) !== null;
}

/** Record the engine's trip for the next BREAKER_HOLD_MS. A "not tripped"
 *  reading changes nothing: the hold expires on its own, so a later
 *  completion that did not trip can never clear a trip early. */
export function noteSpeedBreakerTrip(tripped: boolean): Promise<void> {
  if (!tripped) return Promise.resolve();
  return AsyncStorage.setItem(
    BREAKER_STORE_KEY,
    JSON.stringify({ atMs: Date.now() }),
  ).then(
    () => undefined,
    () => undefined,
  );
}

export async function readSpeedBreakerTrip(): Promise<BreakerTrip> {
  try {
    const raw = await AsyncStorage.getItem(BREAKER_STORE_KEY);
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    const atMs =
      parsed !== null && typeof parsed === "object"
        ? (parsed as { atMs?: unknown }).atMs
        : undefined;
    return typeof atMs === "number" && Number.isFinite(atMs) ? { atMs } : null;
  } catch {
    return null;
  }
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const count = (value: unknown): number =>
  isFiniteNumber(value) && value > 0 ? Math.floor(value) : 0;

/** Three significant digits, keeping a null as null. */
const rounded = (value: number | null): number | null =>
  value === null ? null : Number(value.toPrecision(3));

/** A stored fit, or an empty one: the matrix has a fixed shape and nothing
 *  else is loadable, so a truncated or foreign write starts the fit over
 *  rather than corrupting a solve. */
export function heatStateFrom(parsed: unknown): HeatFitState {
  const empty = emptyHeatFit();
  const input = (parsed !== null && typeof parsed === "object" ? parsed : {}) as Record<
    string,
    unknown
  >;
  const gram = input.gram;
  if (!Array.isArray(gram) || gram.length !== HEAT_COLUMNS) return empty;
  const rows = gram.map((row) =>
    Array.isArray(row) && row.length === HEAT_COLUMNS && row.every(isFiniteNumber) ? row : null,
  );
  if (rows.some((row) => row === null)) return empty;
  const rhs = Array.isArray(input.rhs) && input.rhs.length === HEAT_COLUMNS && input.rhs.every(isFiniteNumber)
    ? (input.rhs as number[])
    : empty.rhs;
  return {
    gram: rows as number[][],
    rhs,
    weight: isFiniteNumber(input.weight) && input.weight > 0 ? input.weight : 0,
    rss: isFiniteNumber(input.rss) && input.rss > 0 ? input.rss : 0,
  };
}

/** A stored record rebuilt on the current shipped row. Anything unreadable
 *  becomes the seed, never a NaN: a damaged store must not poison a fit.
 *  Anything from another shape version starts over: a v that no longer matches
 *  means the fields below no longer mean what this code assumes. */
export function learnedRecordFrom(
  parsed: unknown,
  fp: LearnedFingerprint,
  seeds: LearnedSeeds,
): LearnedRecord {
  const storedVersion =
    parsed !== null && typeof parsed === "object"
      ? (parsed as { v?: unknown }).v
      : undefined;
  const input =
    storedVersion === 1 && parsed !== null && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  const stored = (value: unknown, fallback: Record<Leg, number>): Record<Leg, number> => {
    const legs = (value !== null && typeof value === "object" ? value : {}) as Record<
      string,
      unknown
    >;
    const out = {} as Record<Leg, number>;
    for (const leg of LEGS) out[leg] = isFiniteNumber(legs[leg]) ? legs[leg] : fallback[leg];
    return out;
  };
  const prefill = (value: unknown): Record<Leg, number | null> => {
    const legs = (value !== null && typeof value === "object" ? value : {}) as Record<
      string,
      unknown
    >;
    const out = {} as Record<Leg, number | null>;
    for (const leg of LEGS) out[leg] = isFiniteNumber(legs[leg]) && legs[leg] > 0 ? legs[leg] : null;
    return out;
  };
  return {
    v: 1,
    fp,
    tps: stored(input.tps, seeds.tps),
    prefillTps: prefill(input.prefillTps),
    heat: heatStateFrom(input.heat),
    heatRows: count(input.heatRows),
    heatRejects: count(input.heatRejects),
  };
}

/** The KALSA_GOVERNOR_LEARNED payload: numbers only. The fingerprint stays out
 *  on purpose — Build.FINGERPRINT is not a bounded identifier, and the line
 *  already comes from this one phone.
 *
 *  Values are rounded to three significant digits because finalizeLine clips
 *  any line past 300 characters, and an unrounded double (0.0828078...) spends
 *  the tail of the line on digits no one reads — a clipped report silently
 *  loses whole fields, which is worse than a value off its fourth digit. */
export function learnedLogFields(
  record: LearnedRecord,
  seeds: LearnedSeeds,
  trip: BreakerTrip,
  nowMs: number,
): Record<string, number | null> {
  const fit = solveHeat(record.heat, heatPrior(seeds.heat));
  const heat = (leg: Leg): number | null =>
    rounded(
      legHeatUcb(fit.mean[HEAT_LEG_COLUMN[leg]], fit.sd[HEAT_LEG_COLUMN[leg]], seeds.heat[leg]),
    );
  return {
    tps_cpu: rounded(record.tps.cpu),
    tps_gpu: rounded(record.tps.gpu),
    tps_npu: rounded(record.tps.npu),
    prefill_tps_cpu: rounded(record.prefillTps.cpu),
    prefill_tps_gpu: rounded(record.prefillTps.gpu),
    prefill_tps_npu: rounded(record.prefillTps.npu),
    heat_cpu: heat("cpu"),
    heat_gpu: heat("gpu"),
    heat_npu: heat("npu"),
    heat_bg: rounded(backgroundUcb(fit.mean[HEAT_WALL_COLUMN], fit.sd[HEAT_WALL_COLUMN])),
    heat_sigma: rounded(fit.sigma),
    heat_rows: record.heatRows,
    heat_rejects: record.heatRejects,
    breaker: breakerLatched(trip, nowMs) ? 1 : 0,
    breaker_hold_ms: breakerHoldMsLeft(trip, nowMs),
  };
}

let chain: Promise<void> = Promise.resolve();

/** Absorb one observation row. Fire-and-forget from the completion hook; the
 *  returned promise never rejects, so the caller can void it. */
export function recordLearnedObservation(row: GovernorObservationRow): Promise<void> {
  const next = chain.then(
    () => absorb(row),
    () => absorb(row),
  );
  chain = next.catch(() => undefined);
  return next;
}

async function absorb(row: GovernorObservationRow): Promise<void> {
  try {
    // The build fingerprint and the device model are the two key components
    // the row does not carry; without the fingerprint a store cannot be keyed
    // at all — that is the OTA case it exists for.
    const profile = await getCachedDeviceProfile();
    const build = profile.buildFingerprint;
    if (!build) return;
    const seeds = shippedLearnedSeeds(row.fp.soc);
    if (!seeds) return;
    const inputs = learnedInputsFromRow(row);
    if (!inputs) return;

    const fp: LearnedFingerprint = {
      model: row.fp.model,
      device: profile.modelName ?? "",
      soc: row.fp.soc,
      build,
      pin: row.fp.pin,
    };
    const key = learnedStoreKey(fp);
    const nowMs = Date.now();
    const record = learnedRecordFrom(await readStored(key), fp, seeds);

    for (const leg of LEGS) {
      const sample = inputs.decodeTps[leg];
      if (sample !== null) record.tps[leg] = ewmaSpeed(record.tps[leg], sample);
    }
    if (inputs.prefill) {
      record.prefillTps[inputs.prefill.leg] = ewmaSpeed(
        record.prefillTps[inputs.prefill.leg],
        inputs.prefill.tps,
      );
    }
    if (inputs.heat) {
      const prior = heatPrior(seeds.heat);
      const updated = updateHeat(record.heat, prior, inputs.heat.x, inputs.heat.y);
      record.heat = updated.state;
      if (updated.accepted) record.heatRows += 1;
      else record.heatRejects += 1;
    }
    await AsyncStorage.setItem(key, JSON.stringify(record));
    console.log(
      `KALSA_GOVERNOR_LEARNED ${JSON.stringify(
        learnedLogFields(record, seeds, await readSpeedBreakerTrip(), nowMs),
      )}`,
    );
  } catch {
    // The learned store is shadow state: a read or write failure must never
    // reach the turn that produced the row.
  }
}

async function readStored(key: string): Promise<unknown> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}