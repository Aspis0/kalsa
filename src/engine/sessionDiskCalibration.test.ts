// A real AsyncStorage: the defect this change fixes lives in the store's
// write-back, so a mock that forgets would let the bug pass.
const memoryStore = new Map<string, string>();
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => memoryStore.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => {
      memoryStore.set(k, v);
    }),
    removeItem: jest.fn(async (k: string) => {
      memoryStore.delete(k);
    }),
  },
}));

jest.mock("expo-file-system/legacy", () => ({
  __esModule: true,
  documentDirectory: "file:///kalsa/",
  getInfoAsync: jest.fn(async () => ({ exists: false, isDirectory: false })),
}));

import {
  SESSION_CALIBRATION_MIN_TOKENS,
  SESSION_FIXED_BYTES,
  applySessionDiskCalibration,
  mergeSessionDiskCalibrations,
  recordSessionDiskSample,
  sessionBytesPerTokenForModel,
} from "./sessionDiskCalibration";
import { registrySessionBytesPerToken } from "./sessionDiskFallback";
import {
  loadSessionDiskCalibration,
  saveSessionDiskCalibration,
} from "./sessionDiskCalibrationStore";
import {
  SESSION_DISK_FLOOR_BYTES,
  SESSION_DISK_MARGIN,
  estimateSessionBytes,
  sessionDiskBytesRequired,
} from "./sessionPersistence";

/**
 * Ground truth, read off the S23 on 2026-09-17: the `.kvs` header of
 * lfm2_002e5-2_002e6b__conv-1789618527070-eroeg7un gave magic `ggsn`,
 * version 9, token count 0x1954 = 6484, and the file was 43,622,476 bytes.
 */
const REAL_FILE_BYTES = 43_622_476;
const REAL_FILE_TOKENS = 6484;
const MODEL = "lfm2.5-2.6b";
const N_CTX = 8192;

beforeEach(() => memoryStore.clear());

describe("registry fallback", () => {
  it("knows the shipped model's cost before any write is observed", () => {
    const fallback = registrySessionBytesPerToken(MODEL);
    expect(fallback).not.toBeNull();
    // 6656 measured KV + 16 bytes of per-cell/token bookkeeping.
    expect(fallback).toBe(6656 + 16);
    // Must be within a few percent of the real file, or the whole point of
    // preferring it over the 64 KiB dense ceiling is lost.
    const perToken = REAL_FILE_BYTES / REAL_FILE_TOKENS;
    expect(Math.abs(fallback! - perToken) / perToken).toBeLessThan(0.02);
  });

  it("is used when nothing has been calibrated", () => {
    expect(sessionBytesPerTokenForModel({}, MODEL, registrySessionBytesPerToken(MODEL))).toBe(6656 + 16);
    expect(sessionBytesPerTokenForModel(null, MODEL, registrySessionBytesPerToken(MODEL))).toBe(6656 + 16);
  });

  it("returns null for a model the catalog does not know", () => {
    expect(registrySessionBytesPerToken("not-a-model")).toBeNull();
    expect(sessionBytesPerTokenForModel({}, "not-a-model", registrySessionBytesPerToken("not-a-model"))).toBeNull();
  });

  it("keeps an uncalibrated device inside a plausible disk budget", () => {
    // The regression this guards: with the 64 KiB dense fallback the gate
    // demanded 639 MB free for a 43.6 MB file, and since a rate is only
    // learned from a SUCCESSFUL save, such a device could never correct it.
    const rate = sessionBytesPerTokenForModel({}, MODEL, registrySessionBytesPerToken(MODEL));
    const required = sessionDiskBytesRequired(REAL_FILE_TOKENS, rate ?? undefined);
    expect(required).toBeLessThan(150 * 1024 * 1024);
    // Still above the write's real peak (old file + tmp).
    expect(required).toBeGreaterThan(2 * REAL_FILE_BYTES);
  });
});

describe("recordSessionDiskSample", () => {
  it("round-trips a real measured file: learn from it, then estimate it back", () => {
    const learned = recordSessionDiskSample(
      {},
      {
        ok: true,
        modelId: MODEL,
        fileBytes: REAL_FILE_BYTES,
        usedTokens: REAL_FILE_TOKENS,
        knownBytesPerToken: registrySessionBytesPerToken(MODEL),
      },
    );
    const rate = sessionBytesPerTokenForModel(learned, MODEL, registrySessionBytesPerToken(MODEL));
    const estimated = estimateSessionBytes(REAL_FILE_TOKENS, rate ?? undefined);
    expect(Math.abs(estimated - REAL_FILE_BYTES)).toBeLessThan(1024);
    // The round-trip above is an identity for ANY fixed term, so pin the term
    // itself: at least the 361,228 measured on the device (under-subtracting
    // would over-charge the tokens) and not far above it (over-subtracting
    // biases every learned rate downward).
    expect(SESSION_FIXED_BYTES).toBe(361_228);
    // And the learned slope must land on the real one, not near it.
    expect(rate!).toBeCloseTo(6672, 0);
  });

  it("refuses a sample too short to measure a rate", () => {
    // The poisoning write: ~19 tokens, whose file is almost entirely the
    // fixed recurrent state. Charged to the tokens it reads as ~29,900
    // B/token, 4.5x the truth, and v1 kept that number forever.
    const tiny = recordSessionDiskSample(
      {},
      { ok: true, modelId: MODEL, fileBytes: 565_564, usedTokens: 19, knownBytesPerToken: registrySessionBytesPerToken(MODEL) },
    );
    expect(tiny[MODEL]).toBeUndefined();
  });

  it("learns at the floor but not one token below it", () => {
    const bytes = 40_000_000;
    const below = recordSessionDiskSample(
      {},
      {
        ok: true,
        modelId: MODEL,
        fileBytes: bytes,
        usedTokens: SESSION_CALIBRATION_MIN_TOKENS - 1,
        knownBytesPerToken: registrySessionBytesPerToken(MODEL),
      },
    );
    expect(below[MODEL]).toBeUndefined();

    const at = recordSessionDiskSample(
      {},
      {
        ok: true,
        modelId: MODEL,
        fileBytes: bytes,
        usedTokens: SESSION_CALIBRATION_MIN_TOKENS,
        knownBytesPerToken: registrySessionBytesPerToken(MODEL),
      },
    );
    // Pin the value, not just its presence: asserting non-null lets a
    // mutation that learns garbage at the floor survive.
    expect(at[MODEL]).toBeCloseTo(
      (bytes - SESSION_FIXED_BYTES) / SESSION_CALIBRATION_MIN_TOKENS,
      6,
    );
  });

  it("learning at the floor still over-estimates a full context", () => {
    // The floor's real job is bounding affine extrapolation error. Learn from
    // the shortest write we accept, then estimate a full window and require
    // the gate to stay ahead of what that file would actually be.
    const n0 = SESSION_CALIBRATION_MIN_TOKENS;
    const realFixed = SESSION_FIXED_BYTES;
    const slope = REAL_FILE_BYTES / REAL_FILE_TOKENS;
    const learned = recordSessionDiskSample(
      {},
      {
        ok: true,
        modelId: MODEL,
        fileBytes: Math.round(n0 * slope + realFixed),
        usedTokens: n0,
        knownBytesPerToken: registrySessionBytesPerToken(MODEL),
      },
    );
    const rate = sessionBytesPerTokenForModel(learned, MODEL, registrySessionBytesPerToken(MODEL));
    const estimated = estimateSessionBytes(N_CTX, rate ?? undefined);
    const trueBytes = N_CTX * slope + realFixed;
    expect(estimated).toBeGreaterThan(trueBytes);
  });

  it("refuses a rate below what the cache physically costs", () => {
    // Replacing instead of maximising removed the guard against a LOW
    // outlier. A session file contains the quantized KV rows, so it cannot
    // cost less per token than the catalog measured.
    const floor = registrySessionBytesPerToken(MODEL)!;
    const tooCheap = recordSessionDiskSample(
      { [MODEL]: 8000 },
      {
        ok: true,
        modelId: MODEL,
        fileBytes: Math.round(2000 * (floor / 10)) + SESSION_FIXED_BYTES,
        usedTokens: 2000,
        knownBytesPerToken: registrySessionBytesPerToken(MODEL),
      },
    );
    expect(tooCheap[MODEL]).toBe(8000);
  });

  it("corrects a stored rate downwards", () => {
    const corrected = recordSessionDiskSample(
      { [MODEL]: 29_910 },
      {
        ok: true,
        modelId: MODEL,
        fileBytes: REAL_FILE_BYTES,
        usedTokens: REAL_FILE_TOKENS,
        knownBytesPerToken: registrySessionBytesPerToken(MODEL),
      },
    );
    expect(corrected[MODEL]).toBeLessThan(29_910);
    expect(corrected[MODEL]).toBeGreaterThan(6_000);
  });

  it("leaves other models alone and rejects failed writes", () => {
    const start = { other: 1234 };
    expect(
      recordSessionDiskSample(start, {
        ok: false,
        modelId: MODEL,
        fileBytes: REAL_FILE_BYTES,
        usedTokens: REAL_FILE_TOKENS,
        knownBytesPerToken: registrySessionBytesPerToken(MODEL),
      }),
    ).toEqual(start);
    expect(
      recordSessionDiskSample(start, {
        ok: true,
        modelId: MODEL,
        fileBytes: REAL_FILE_BYTES,
        usedTokens: REAL_FILE_TOKENS,
        knownBytesPerToken: registrySessionBytesPerToken(MODEL),
      }).other,
    ).toBe(1234);
  });
});

describe("the store, end to end", () => {
  it("persists a correction instead of maximising it away", async () => {
    // The defect verbatim: the write-back went through
    // mergeSessionDiskCalibrations, so a corrected LOWER rate was discarded
    // by the very call meant to save it. A pure-function test cannot see this.
    await saveSessionDiskCalibration({ [MODEL]: 29_910 });
    expect((await loadSessionDiskCalibration())[MODEL]).toBe(29_910);

    await saveSessionDiskCalibration({ [MODEL]: 6_566 });
    expect((await loadSessionDiskCalibration())[MODEL]).toBe(6_566);
  });

  it("keeps keys the update does not mention", async () => {
    await saveSessionDiskCalibration({ [MODEL]: 29_910, other: 50 });
    await saveSessionDiskCalibration({ [MODEL]: 6_566 });
    const loaded = await loadSessionDiskCalibration();
    expect(loaded).toEqual({ [MODEL]: 6_566, other: 50 });
  });

  it("starts empty for a device that only ever stored the v1 key", async () => {
    memoryStore.set("kalsa.session.disk.v1", JSON.stringify({ [MODEL]: 29_910 }));
    expect(await loadSessionDiskCalibration()).toEqual({});
  });
});

describe("applySessionDiskCalibration", () => {
  it("lets the update win, keeps the rest", () => {
    expect(
      applySessionDiskCalibration({ [MODEL]: 29_910, other: 50 }, { [MODEL]: 6_566 }),
    ).toEqual({ [MODEL]: 6_566, other: 50 });
  });

  it("ignores invalid values from either side", () => {
    expect(
      applySessionDiskCalibration(
        { a: 10, b: Number.NaN as number },
        { a: -1 as number, c: 7 },
      ),
    ).toEqual({ a: 10, c: 7 });
  });
});

describe("mergeSessionDiskCalibrations", () => {
  it("still takes the maximum when combining stores", () => {
    expect(mergeSessionDiskCalibrations({ a: 10 }, { a: 20 })).toEqual({ a: 20 });
    expect(mergeSessionDiskCalibrations({ a: 20 }, { a: 10 })).toEqual({ a: 20 });
  });
});

describe("the disk gate", () => {
  it("demands more than the write's peak footprint", () => {
    // saveEngineSession writes the whole new file to .tmp while the previous
    // .kvs is still on disk, so the peak is old + tmp. A margin at or below
    // 2.0 lets the gate pass a write that cannot finish.
    expect(SESSION_DISK_MARGIN).toBeGreaterThan(2);
    const rate = REAL_FILE_BYTES / REAL_FILE_TOKENS;
    expect(sessionDiskBytesRequired(REAL_FILE_TOKENS, rate)).toBeGreaterThan(
      2 * REAL_FILE_BYTES,
    );
  });

  it("applies the margin to the estimate", () => {
    expect(sessionDiskBytesRequired(10_000, 1_000)).toBe(
      (10_000 * 1_000 + SESSION_FIXED_BYTES) * SESSION_DISK_MARGIN,
    );
  });

  it("never asks less than the floor", () => {
    expect(sessionDiskBytesRequired(1, 1)).toBe(SESSION_DISK_FLOOR_BYTES);
  });
});

describe("estimateSessionBytes", () => {
  it("carries the fixed term", () => {
    expect(estimateSessionBytes(1000, 1000)).toBe(1000 * 1000 + SESSION_FIXED_BYTES);
  });

  it("stays zero for an empty session", () => {
    expect(estimateSessionBytes(0, 1000)).toBe(0);
  });
});
