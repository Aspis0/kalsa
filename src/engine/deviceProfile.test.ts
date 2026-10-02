/**
 * The iOS device-profile fallback and the zero-headroom gate semantics from
 * the ios/first-build audit:
 * - when expo-device cannot read totalMemory, the Apple class supplies the
 *   reported bytes AND the RAM tier (they must never contradict each other);
 * - a 0 MemAvailable/jetsam reading is zero headroom, not unknown: the gate
 *   refuses, the fit evaluates, only a missing read stays unknown.
 */
jest.mock("react-native", () => ({
  Platform: { OS: "ios" },
  NativeModules: {},
}));

const mockExpoDevice = {
  brand: "Apple",
  manufacturer: "Apple Inc.",
  modelName: "iPhone",
  modelId: "iPhone18,1" as string | null,
  totalMemory: null as number | null,
  osName: "iOS",
  osVersion: "26.0",
  deviceType: 1,
};
jest.mock("expo-device", () => mockExpoDevice);

const mockAvailableMemoryBytes = jest.fn<Promise<number | null>, []>();
jest.mock("../../modules/kalsa-lifecycle/src", () => ({
  getOsAvailableMemoryBytes: () => mockAvailableMemoryBytes(),
}));

import {
  getCachedDeviceProfile,
  modelGateVerdict,
  evaluateModelFit,
  decidePreSendFit,
  __resetDeviceProfileCacheForTests,
} from "./deviceProfile";

const TWELVE_GIB = 12_884_901_888;

describe("buildDeviceProfile Apple fallback (via the cached profile)", () => {
  beforeEach(() => {
    __resetDeviceProfileCacheForTests();
    mockAvailableMemoryBytes.mockReset();
    mockAvailableMemoryBytes.mockResolvedValue(0);
    mockExpoDevice.modelId = "iPhone18,1";
    mockExpoDevice.totalMemory = null;
  });

  it("feeds the tier from the SAME fallback bytes the profile reports", async () => {
    const profile = await getCachedDeviceProfile();
    expect(profile.totalMemoryBytes).toBe(TWELVE_GIB);
    // The old bug: profile reported the fallback bytes but the tier classified
    // the null Expo read — the same 12-GiB device gated as "low".
    expect(profile.ramTier).toBe("high");
    expect(profile.socModel).toBe("A19 Pro");
    expect(profile.socManufacturer).toBe("Apple");
  });

  it("keeps the Expo totalMemory read authoritative over the map", async () => {
    mockExpoDevice.totalMemory = 4_000_000_000;
    const profile = await getCachedDeviceProfile();
    expect(profile.totalMemoryBytes).toBe(4_000_000_000);
    expect(profile.ramTier).toBe("low");
  });

  it("carries a 0 jetsam reading into the profile as 0", async () => {
    const profile = await getCachedDeviceProfile();
    expect(profile.availableMemoryBytes).toBe(0);
  });

  it("falls back to unknown-tier generics off the mapped devices", async () => {
    mockExpoDevice.modelId = "iPhone19,9";
    const profile = await getCachedDeviceProfile();
    expect(profile.totalMemoryBytes).toBeNull();
    expect(profile.ramTier).toBe("low");
    expect(profile.socModel).toBeNull();
  });
});

describe("modelGateVerdict with a 0 available reading", () => {
  const base = {
    totalMemoryBytes: TWELVE_GIB,
    availableMemoryBytes: 0,
    freeDiskBytes: 100_000_000_000,
    ramTier: "high" as const,
    modelSizeBytes: 1_000_000_000,
  };

  it("blocks the load (zero headroom cannot take a positive charge)", () => {
    const verdict = modelGateVerdict({
      ...base,
      modelNonEvictableMiB: 500,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe("blocked_ram");
  });

  it("is known (ok), not unknown, when nothing needs charging", () => {
    const verdict = modelGateVerdict({
      ...base,
      modelNonEvictableMiB: null,
    });
    expect(verdict.allowed).toBe(true);
    expect(verdict.reason).toBe("ok");
  });

  it("stays unknown only when the read itself does not exist", () => {
    const verdict = modelGateVerdict({
      ...base,
      availableMemoryBytes: null,
      totalMemoryBytes: null,
      modelNonEvictableMiB: null,
    });
    expect(verdict.allowed).toBe(true);
    expect(verdict.reason).toBe("unknown");
  });
});

describe("fit paths with a 0 available reading", () => {
  const model = {
    sizeBytes: 1_000_000_000,
    engineCtx: 8192,
    kvBytesPerToken: null,
    mmproj: null,
  };

  it("evaluateModelFit → does_not_fit at 0 available", () => {
    expect(evaluateModelFit(model, 0)).toEqual({
      verdict: "does_not_fit",
      reasonKey: "model.tooLarge",
    });
  });

  it("decidePreSendFit refuses the send at 0 available", () => {
    expect(decidePreSendFit(model, 0)).toEqual({
      allow: false,
      reasonKey: "model.tooLarge",
    });
  });

  it("both stay unknown at null available (fail-open preserved)", () => {
    expect(evaluateModelFit(model, null).verdict).toBe("unknown");
    expect(decidePreSendFit(model, null)).toEqual({
      allow: true,
      bannerKey: "model.memoryUnknown",
    });
  });
});
