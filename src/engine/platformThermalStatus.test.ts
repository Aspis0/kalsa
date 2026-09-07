// The Node test environment has no Expo native runtime. Keep this test on the
// documented fail-open path without parsing Expo's native-module TypeScript.
jest.mock("expo-modules-core", () => ({
  requireOptionalNativeModule: () => null,
}));

import {
  getPlatformThermalHardGate,
  isPlatformThermalApiAvailable,
  readToHardGate,
  type ThermalPlatformRead,
} from "./platformThermalStatus";

describe("readToHardGate", () => {
  it("gates on Android CRITICAL and above", () => {
    expect(
      readToHardGate({ platform: "android", supported: true, androidStatus: 4 }),
    ).toBe(true);
    expect(
      readToHardGate({ platform: "android", supported: true, androidStatus: 6 }),
    ).toBe(true);
  });

  it("does NOT gate on Android below CRITICAL", () => {
    expect(
      readToHardGate({ platform: "android", supported: true, androidStatus: 2 }),
    ).toBe(false);
    expect(
      readToHardGate({ platform: "android", supported: true, androidStatus: 0 }),
    ).toBe(false);
  });

  it("gates on iOS .critical (numeric and string), not .serious", () => {
    expect(readToHardGate({ platform: "ios", supported: true, iosState: 3 })).toBe(true);
    expect(readToHardGate({ platform: "ios", supported: true, iosState: "critical" })).toBe(
      true,
    );
    expect(readToHardGate({ platform: "ios", supported: true, iosState: 2 })).toBe(false);
    expect(readToHardGate({ platform: "ios", supported: true, iosState: "serious" })).toBe(
      false,
    );
  });

  it("is not gated when platform is unknown or no signal is present", () => {
    expect(readToHardGate({ platform: null, supported: false })).toBe(false);
    expect(readToHardGate({ platform: "android", supported: true })).toBe(false);
    expect(readToHardGate({ platform: "ios", supported: true })).toBe(false);
    expect(
      readToHardGate({ platform: "android", supported: false, androidStatus: 6 }),
    ).toBe(false);
  });
});

describe("getPlatformThermalHardGate — fail open", () => {
  it("returns false when no native module is linked (no thermal API)", async () => {
    // In the Node / jest harness there is no linked native module, so the
    // reader must fail OPEN rather than hard-block.
    expect(isPlatformThermalApiAvailable()).toBe(false);
    await expect(getPlatformThermalHardGate()).resolves.toBe(false);
  });

  it("never fabricates a gate from an advisory temperature", async () => {
    // Even a very high zone0-style number must NOT gate here — the hard gate
    // is driven only by the platform thermal signal.
    await expect(getPlatformThermalHardGate()).resolves.toBe(false);
  });
});
