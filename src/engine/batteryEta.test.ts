import {
  BATTERY_ETA_DEFAULTS,
  estimateBatteryEtaHours,
  type BatterySample,
} from "./batteryEta";

/** Build samples spaced `stepMin` minutes apart, dropping `dropPct` total. */
function samples(stepMin: number, dropPct: number, start = 40): BatterySample[] {
  const now = Date.now();
  const stepMs = stepMin * 60_000;
  return [0, 1, 2].map((i) => ({
    tMs: now - i * stepMs,
    percent: start - (dropPct / 2) * i,
  }));
}

describe("estimateBatteryEtaHours — gates", () => {
  it("returns unknown for empty / null input", () => {
    expect(estimateBatteryEtaHours([])).toEqual({ kind: "unknown" });
    expect(estimateBatteryEtaHours(null)).toEqual({ kind: "unknown" });
  });

  it("returns measuring when fewer than minSamples", () => {
    const s: BatterySample[] = [
      { tMs: 0, percent: 40 },
      { tMs: 600_000, percent: 38 },
    ];
    const r = estimateBatteryEtaHours(s);
    expect(r.kind).toBe("measuring");
  });

  it("returns measuring when span is below the minimum", () => {
    // 3 samples, 2% drop, but only 4 min span (< 10 min).
    const s: BatterySample[] = [
      { tMs: 0, percent: 40 },
      { tMs: 120_000, percent: 39 },
      { tMs: 240_000, percent: 38 },
    ];
    expect(estimateBatteryEtaHours(s).kind).toBe("measuring");
  });

  it("returns unknown when net drop is below the minimum (flat)", () => {
    // 3 samples over 12 min but only 1% total drop → exactly at threshold.
    const s: BatterySample[] = [
      { tMs: 0, percent: 40 },
      { tMs: 360_000, percent: 39.5 },
      { tMs: 720_000, percent: 39 },
    ];
    expect(estimateBatteryEtaHours(s).kind).toBe("unknown");
  });

  it("returns charging when the battery rose across the window", () => {
    const s: BatterySample[] = [
      { tMs: 0, percent: 38 },
      { tMs: 360_000, percent: 39 },
      { tMs: 720_000, percent: 41 },
    ];
    expect(estimateBatteryEtaHours(s).kind).toBe("charging");
  });

  it("returns unknown when samples are non-finite", () => {
    const s = [
      { tMs: Number.NaN, percent: 40 },
      { tMs: 360_000, percent: Number.NaN },
      { tMs: 720_000, percent: 38 },
    ] as unknown as BatterySample[];
    expect(estimateBatteryEtaHours(s).kind).toBe("unknown");
  });
});

describe("estimateBatteryEtaHours — eta band", () => {
  it("produces a bounded band for a healthy drain", () => {
    // 3 samples, 10 min span, 2% drop → rate 12%/h.
    // Reserve 5% from last (38%) → 33% headroom → eta 2.75h.
    const s: BatterySample[] = [
      { tMs: 0, percent: 40 },
      { tMs: 360_000, percent: 39 },
      { tMs: 720_000, percent: 38 },
    ];
    const r = estimateBatteryEtaHours(s);
    expect(r.kind).toBe("eta");
    expect(r.lowHours).toBeGreaterThanOrEqual(2.5);
    expect(r.lowHours).toBeLessThanOrEqual(2.75);
    expect(r.highHours).toBeGreaterThanOrEqual(2.75);
    // Half-hour banding: low=2.5, high=3.0.
    expect(r.lowHours).toBe(2.5);
    expect(r.highHours).toBe(3);
    expect(typeof r.ratePctPerHour).toBe("number");
  });

  it("returns unknown when reserve exceeds the current level", () => {
    const s: BatterySample[] = [
      { tMs: 0, percent: 10 },
      { tMs: 360_000, percent: 9 },
      { tMs: 720_000, percent: 8 },
    ];
    // Last 8%, reserve 5% → 3% headroom; rate 12%/h → eta 0.25h (valid).
    // Force the unknown path by raising the reserve.
    const r = estimateBatteryEtaHours(s, { reservePct: 10 });
    expect(r.kind).toBe("unknown");
  });

  it("returns unknown for an implausibly steep drain", () => {
    const s: BatterySample[] = [
      { tMs: 0, percent: 40 },
      { tMs: 360_000, percent: 10 },
      { tMs: 720_000, percent: 2 },
    ];
    const r = estimateBatteryEtaHours(s);
    expect(r.kind).toBe("unknown");
  });

  it("returns unknown when the ETA exceeds maxHours", () => {
    // Tiny drain → huge eta; cap at maxHours → unknown.
    const s: BatterySample[] = [
      { tMs: 0, percent: 90 },
      { tMs: 360_000, percent: 89.9 },
      { tMs: 720_000, percent: 89.8 },
    ];
    const r = estimateBatteryEtaHours(s, { maxHours: 48 });
    expect(r.kind).toBe("unknown");
  });

  it("respects custom gates", () => {
    // minSamples=2, minSpanMs=1min, minDropPct=0.5.
    const s: BatterySample[] = [
      { tMs: 0, percent: 40 },
      { tMs: 60_000, percent: 39.5 },
    ];
    const r = estimateBatteryEtaHours(s, {
      minSamples: 2,
      minSpanMs: 60_000,
      minDropPct: 0.5,
    });
    expect(r.kind).toBe("eta");
  });

  it("rounds a sub-hour estimate into a sub-hour band", () => {
    // Large, bounded drain → eta ~0.25h → band [0, 0.5].
    const s: BatterySample[] = [
      { tMs: 0, percent: 40 },
      { tMs: 360_000, percent: 20 },
      { tMs: 720_000, percent: 10 },
    ];
    const r = estimateBatteryEtaHours(s);
    expect(r.kind).toBe("eta");
    expect(r.lowHours).toBe(0);
    expect(r.highHours).toBe(0.5);
  });
});

describe("estimateBatteryEtaHours — defaults", () => {
  it("exposes the production gate constants", () => {
    expect(BATTERY_ETA_DEFAULTS.minSamples).toBe(3);
    expect(BATTERY_ETA_DEFAULTS.minSpanMs).toBe(10 * 60 * 1000);
    expect(BATTERY_ETA_DEFAULTS.minDropPct).toBe(1);
    expect(BATTERY_ETA_DEFAULTS.reservePct).toBe(5);
  });
});