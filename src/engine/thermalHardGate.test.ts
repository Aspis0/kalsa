import {
  isAndroidThermalHardGated,
  isIosThermalHardGated,
  THERMAL_STATUS_CRITICAL,
  THERMAL_STATUS_EMERGENCY,
  THERMAL_STATUS_SHUTDOWN,
  THERMAL_STATE_CRITICAL,
} from "./thermalHardGate";

describe("isAndroidThermalHardGated", () => {
  it("uses the platform CRITICAL constant (4)", () => {
    expect(THERMAL_STATUS_CRITICAL).toBe(4);
  });

  it("gates at CRITICAL and above (CRITICAL / EMERGENCY / SHUTDOWN)", () => {
    expect(isAndroidThermalHardGated(THERMAL_STATUS_CRITICAL)).toBe(true);
    expect(isAndroidThermalHardGated(THERMAL_STATUS_EMERGENCY)).toBe(true);
    expect(isAndroidThermalHardGated(THERMAL_STATUS_SHUTDOWN)).toBe(true);
    expect(isAndroidThermalHardGated(4)).toBe(true);
    expect(isAndroidThermalHardGated(6)).toBe(true);
  });

  it("does NOT gate below CRITICAL (throttling / reduction signals)", () => {
    // NONE=0, PERCEPTIBLE=1, SEVERE=2 — none of these block new turns.
    expect(isAndroidThermalHardGated(0)).toBe(false);
    expect(isAndroidThermalHardGated(1)).toBe(false);
    expect(isAndroidThermalHardGated(2)).toBe(false);
    expect(isAndroidThermalHardGated(3)).toBe(false);
  });

  it("fails open on non-integer / undefined / NaN", () => {
    expect(isAndroidThermalHardGated(NaN)).toBe(false);
    expect(isAndroidThermalHardGated(4.5)).toBe(false);
    // @ts-expect-error — runtime guard for a missing API.
    expect(isAndroidThermalHardGated(undefined)).toBe(false);
  });
});

describe("isIosThermalHardGated", () => {
  it("uses the platform .critical constant (3)", () => {
    expect(THERMAL_STATE_CRITICAL).toBe(3);
  });

  it("gates on the numeric .critical value", () => {
    expect(isIosThermalHardGated(THERMAL_STATE_CRITICAL)).toBe(true);
    expect(isIosThermalHardGated(3)).toBe(true);
    // Future/unknown enum values fail open; only Apple's .critical gates.
    expect(isIosThermalHardGated(4)).toBe(false);
  });

  it("gates on the symbolic string 'critical' (any case)", () => {
    expect(isIosThermalHardGated("critical")).toBe(true);
    expect(isIosThermalHardGated("CRITICAL")).toBe(true);
    expect(isIosThermalHardGated(" critical ")).toBe(true);
  });

  it("does NOT gate on .serious / .fair / .nominal", () => {
    expect(isIosThermalHardGated(2)).toBe(false); // .serious
    expect(isIosThermalHardGated(1)).toBe(false); // .fair
    expect(isIosThermalHardGated(0)).toBe(false); // .nominal
    expect(isIosThermalHardGated("serious")).toBe(false);
    expect(isIosThermalHardGated("fair")).toBe(false);
    expect(isIosThermalHardGated("nominal")).toBe(false);
  });

  it("fails open on unknown / missing values", () => {
    expect(isIosThermalHardGated("")).toBe(false);
    expect(isIosThermalHardGated("warm")).toBe(false);
    // @ts-expect-error — runtime guard for a missing API.
    expect(isIosThermalHardGated(undefined)).toBe(false);
    expect(isIosThermalHardGated(NaN)).toBe(false);
  });
});
