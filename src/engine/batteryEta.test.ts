import {
  BATTERY_ETA_DEFAULTS,
  estimateBatteryEtaHours,
  type BatterySample,
} from "./batteryEta";

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
    expect(estimateBatteryEtaHours(s).kind).toBe("measuring");
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
    // 3 samples over 12 min but only 1% total drop → 5 %/h < 6 %/h gate.
    const s: BatterySample[] = [
      { tMs: 0, percent: 40 },
      { tMs: 360_000, percent: 39.5 },
      { tMs: 720_000, percent: 39 },
    ];
    expect(estimateBatteryEtaHours(s).kind).toBe("unknown");
  });

  it("returns charging when the battery rose >= 2 pp across the window", () => {
    const s: BatterySample[] = [
      { tMs: 0, percent: 38 },
      { tMs: 360_000, percent: 39 },
      { tMs: 720_000, percent: 41 },
    ];
    expect(estimateBatteryEtaHours(s).kind).toBe("charging");
  });

  it("treats a 1 pp rise as unknown (charging deadband)", () => {
    // Integer-quantized levels bounce ±1 pp; a 1 pp rise is measurement noise,
    // not a genuine plug-in, so it must NOT flip to "charging".
    const s: BatterySample[] = [
      { tMs: 0, percent: 38 },
      { tMs: 360_000, percent: 39 },
      { tMs: 720_000, percent: 39 },
    ];
    expect(estimateBatteryEtaHours(s).kind).toBe("unknown");
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
  it("produces a bounded band for a healthy drain (exactly 10 min span)", () => {
    // 3 samples, exactly 10 min span, 2% drop → observed rate 12 %/h.
    // Reserve 5% from last (38%) → 33% headroom → eta 2.75h → band [2.5, 3.0].
    const s: BatterySample[] = [
      { tMs: 0, percent: 40 },
      { tMs: 360_000, percent: 39 },
      { tMs: 600_000, percent: 38 },
    ];
    const r = estimateBatteryEtaHours(s);
    expect(r.kind).toBe("eta");
    expect(r.lowHours).toBe(2.5);
    expect(r.highHours).toBe(3);
    expect(r.ratePctPerHour).toBe(12);
  });

  it("uses the OBSERVED rate when span exceeds minSpan (F2)", () => {
    // Same 2% drop but 12 min span → observed rate 10 %/h (not 12), so eta is
    // 3.3h → band [3.0, 3.5]. A longer window must NOT shrink the ETA.
    const s: BatterySample[] = [
      { tMs: 0, percent: 40 },
      { tMs: 360_000, percent: 39 },
      { tMs: 720_000, percent: 38 },
    ];
    const r = estimateBatteryEtaHours(s);
    expect(r.kind).toBe("eta");
    expect(r.ratePctPerHour).toBe(10);
    expect(r.lowHours).toBe(3);
    expect(r.highHours).toBe(3.5);
  });

  it("returns unknown when reserve exceeds the current level", () => {
    const s: BatterySample[] = [
      { tMs: 0, percent: 10 },
      { tMs: 360_000, percent: 9 },
      { tMs: 720_000, percent: 8 },
    ];
    // Last 8%, reserve 10% → negative headroom → unknown.
    const r = estimateBatteryEtaHours(s, { reservePct: 10 });
    expect(r.kind).toBe("unknown");
  });

  it("returns unknown for an implausibly steep burst (F4)", () => {
    // 90→50 in 12 min = 200 %/h, far above the 60 %/h burst cap.
    const s: BatterySample[] = [
      { tMs: 0, percent: 90 },
      { tMs: 360_000, percent: 70 },
      { tMs: 720_000, percent: 50 },
    ];
    expect(estimateBatteryEtaHours(s).kind).toBe("unknown");
  });

  it("returns unknown when the ETA exceeds maxHours (F4)", () => {
    // 2% drop over 12 min = 10 %/h (passes the min-rate gate), headroom 83% →
    // eta 8.3h; capped by maxHours 4 → unknown. Actually exercises maxHours.
    const s: BatterySample[] = [
      { tMs: 0, percent: 90 },
      { tMs: 360_000, percent: 89 },
      { tMs: 720_000, percent: 88 },
    ];
    const r = estimateBatteryEtaHours(s, { maxHours: 4 });
    expect(r.kind).toBe("unknown");
  });

  it("rounds a sub-hour estimate into a sub-hour band", () => {
    // 35→25 in 12 min = 50 %/h, headroom 20% → eta 0.4h → band [0, 0.5].
    const s: BatterySample[] = [
      { tMs: 0, percent: 35 },
      { tMs: 360_000, percent: 30 },
      { tMs: 720_000, percent: 25 },
    ];
    const r = estimateBatteryEtaHours(s);
    expect(r.kind).toBe("eta");
    expect(r.lowHours).toBe(0);
    expect(r.highHours).toBe(0.5);
    expect(r.ratePctPerHour).toBe(50);
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
});

describe("estimateBatteryEtaHours — defaults", () => {
  it("exposes the production gate constants", () => {
    expect(BATTERY_ETA_DEFAULTS.minSamples).toBe(3);
    expect(BATTERY_ETA_DEFAULTS.minSpanMs).toBe(10 * 60 * 1000);
    expect(BATTERY_ETA_DEFAULTS.minDropPct).toBe(1);
    expect(BATTERY_ETA_DEFAULTS.reservePct).toBe(5);
    expect(BATTERY_ETA_DEFAULTS.maxHours).toBe(24);
    expect(BATTERY_ETA_DEFAULTS.maxRatePctPerHour).toBe(60);
  });
});