import {
  ZONE0_THERMAL_BANDS,
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
    expect(statusFromTempC(48, "hot")).toBe("hot");
    expect(statusFromTempC(46.1, "hot")).toBe("hot");
    // 46 is exactly the exit threshold (48 − 2): still held.
    expect(statusFromTempC(46, "hot")).toBe("hot");
    // Below the exit threshold: leave hot → warm.
    expect(statusFromTempC(45.9, "hot")).toBe("warm");
  });

  it("holds critical until 50 °C, warm until 43 °C", () => {
    expect(statusFromTempC(50, "critical")).toBe("critical");
    expect(statusFromTempC(49.9, "critical")).toBe("hot");

    expect(statusFromTempC(43, "warm")).toBe("warm");
    expect(statusFromTempC(42.9, "warm")).toBe("ok");
  });

  it("never holds when there is no prior band", () => {
    expect(statusFromTempC(45, "unknown")).toBe("warm");
    expect(statusFromTempC(45)).toBe("warm");
  });
});

describe("toGovernorHint / preferGpuPath", () => {
  const cases: Array<[ThermalStatus, boolean]> = [
    ["ok", false],
    ["unknown", false],
    ["warm", true],
    ["hot", true],
    ["critical", true],
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