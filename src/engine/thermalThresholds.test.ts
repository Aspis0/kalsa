import {
  ZONE0_THERMAL_BANDS,
  MEMORY_PROXY_WARM_BELOW_MIB,
  statusFromTempC,
  toGovernorHint,
  type ThermalStatus,
} from "./thermalThresholds";

describe("statusFromTempC (enter thresholds, no prev)", () => {
  it("classifies by the zone0/unknown bands: 45 / 48 / 52 °C", () => {
    expect(statusFromTempC(41.9)).toBe("ok");
    expect(statusFromTempC(45)).toBe("warm");
    expect(statusFromTempC(47.9)).toBe("warm");
    expect(statusFromTempC(48)).toBe("hot");
    expect(statusFromTempC(51.9)).toBe("hot");
    expect(statusFromTempC(52)).toBe("critical");
    expect(statusFromTempC(60)).toBe("critical");
  });

  it("returns ok below the warm enter point", () => {
    expect(statusFromTempC(30)).toBe("ok");
  });
});

describe("statusFromTempC hysteresis (exit = enter − 2 °C)", () => {
  it("holds a band while cooling until the exit threshold is crossed", () => {
    // Entering hot at 48, then cooling: stay hot until < 46.
    expect(statusFromTempC(48, { prevStatus: "hot" })).toBe("hot");
    expect(statusFromTempC(46.1, { prevStatus: "hot" })).toBe("hot");
    // 46 is exactly the exit threshold (48 − 2): still held.
    expect(statusFromTempC(46, { prevStatus: "hot" })).toBe("hot");
    // Below the exit threshold: leave hot → warm.
    expect(statusFromTempC(45.9, { prevStatus: "hot" })).toBe("warm");
  });

  it("holds critical until 50 °C, warm until 43 °C", () => {
    expect(statusFromTempC(50, { prevStatus: "critical" })).toBe("critical");
    expect(statusFromTempC(49.9, { prevStatus: "critical" })).toBe("hot");

    expect(statusFromTempC(43, { prevStatus: "warm" })).toBe("warm");
    expect(statusFromTempC(42.9, { prevStatus: "warm" })).toBe("ok");
  });

  it("never holds when there is no prior band", () => {
    expect(statusFromTempC(45, { prevStatus: "unknown" })).toBe("warm");
    expect(statusFromTempC(45)).toBe("warm");
  });
});

describe("statusFromTempC source-aware hysteresis", () => {
  it("does not hold a band when the sample source changes", () => {
    // 47 °C raw classifies as "warm", but cooling from "hot" would normally be
    // held (exit 46). A source change (sysfs → memory_proxy) has no shared
    // temperature basis, so it must classify fresh → "warm".
    expect(
      statusFromTempC(47, {
        prevStatus: "hot",
        prevSource: "sysfs",
        source: "memory_proxy",
      }),
    ).toBe("warm");
  });

  it("still applies hysteresis within the same source", () => {
    expect(
      statusFromTempC(47, {
        prevStatus: "hot",
        prevSource: "sysfs",
        source: "sysfs",
      }),
    ).toBe("hot");
    expect(
      statusFromTempC(45.9, {
        prevStatus: "hot",
        prevSource: "sysfs",
        source: "sysfs",
      }),
    ).toBe("warm");
  });
});

describe("toGovernorHint / preferGpuPath", () => {
  const cases: Array<[ThermalStatus, boolean]> = [
    ["ok", false],
    ["unknown", false],
    ["warm", true],
    ["hot", true],
    // critical yields to the platform governor (CRITICAL → CPU, not
    // GPU_COOLMODE), so we do NOT prefer the GPU path there.
    ["critical", false],
  ];

  it.each(cases)("preferGpuPath is %p for status '%s'", (status, prefer) => {
    expect(toGovernorHint(status, 48, "sysfs").preferGpuPath).toBe(prefer);
  });

  it("carries the status, temperature and source for a future bridge", () => {
    expect(toGovernorHint("hot", 48, "sysfs")).toEqual({
      status: "hot",
      tempC: 48,
      source: "sysfs",
      preferGpuPath: true,
    });
  });

  it("reports a null temperature when only a memory proxy is available", () => {
    expect(toGovernorHint("warm", null, "memory_proxy").tempC).toBeNull();
  });
});

describe("MEMORY_PROXY_WARM_BELOW_MIB", () => {
  it("is the named free-RAM floor imported by the hook", () => {
    expect(MEMORY_PROXY_WARM_BELOW_MIB).toBe(512);
  });
});

describe("default bands", () => {
  it("are the named zone0/unknown thresholds with 2 °C hysteresis", () => {
    expect(ZONE0_THERMAL_BANDS).toEqual({
      warmC: 45,
      hotC: 48,
      criticalC: 52,
      exitHysteresisC: 2,
    });
  });
});