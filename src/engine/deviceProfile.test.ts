/**
 * The iOS device-profile Apple class and the zero-headroom gate semantics from
 * the ios/first-build audit:
 * - the Apple map supplies the chip class only; the reported bytes and the RAM
 *   tier both come from the Expo totalMemory read;
 * - on iOS a 0 MemAvailable/jetsam reading is zero headroom, not unknown: the
 *   gate refuses, the fit evaluates, only a missing read stays unknown;
 * - on Android a 0 keeps its origin/main "unknown" meaning — the zero-is-real
 *   scope is the platform, and the Apple map is iOS-gated, not a modelId
 *   accident.
 */
const mockPlatform = { OS: "ios" };
jest.mock("react-native", () => ({
  Platform: mockPlatform,
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

const mockReadAsString = jest.fn<Promise<string>, [string]>();
jest.mock("expo-file-system/legacy", () => ({
  readAsStringAsync: (uri: string) => mockReadAsString(uri),
}));

beforeEach(() => {
  mockPlatform.OS = "ios";
  mockExpoDevice.brand = "Apple";
  mockExpoDevice.manufacturer = "Apple Inc.";
  mockExpoDevice.modelName = "iPhone";
  mockExpoDevice.modelId = "iPhone18,1";
  mockExpoDevice.totalMemory = null;
  mockExpoDevice.osName = "iOS";
  mockExpoDevice.osVersion = "26.0";
  mockExpoDevice.deviceType = 1;
});

import {
  getCachedDeviceProfile,
  modelGateVerdict,
  evaluateModelFit,
  decidePreSendFit,
  __resetDeviceProfileCacheForTests,
} from "./deviceProfile";

const TWELVE_GIB = 12_884_901_888;

describe("buildDeviceProfile Apple class (via the cached profile)", () => {
  beforeEach(() => {
    __resetDeviceProfileCacheForTests();
    mockAvailableMemoryBytes.mockReset();
    mockAvailableMemoryBytes.mockResolvedValue(0);
    mockExpoDevice.modelId = "iPhone18,1";
    mockExpoDevice.totalMemory = TWELVE_GIB;
  });

  it("takes the chip class from the model id and the tier from the Expo read", async () => {
    const profile = await getCachedDeviceProfile();
    expect(profile.totalMemoryBytes).toBe(TWELVE_GIB);
    expect(profile.ramTier).toBe("high");
    expect(profile.socModel).toBe("A19 Pro");
    expect(profile.socManufacturer).toBe("Apple");
  });

  it("classifies a lower Expo totalMemory read as the low tier, chip class unchanged", async () => {
    mockExpoDevice.totalMemory = 4_000_000_000;
    const profile = await getCachedDeviceProfile();
    expect(profile.totalMemoryBytes).toBe(4_000_000_000);
    expect(profile.ramTier).toBe("low");
    expect(profile.socModel).toBe("A19 Pro");
  });

  it("carries a 0 jetsam reading into the profile as 0", async () => {
    const profile = await getCachedDeviceProfile();
    expect(profile.availableMemoryBytes).toBe(0);
  });

  it("gives no chip class off the mapped identifiers", async () => {
    mockExpoDevice.modelId = "iPhone19,9";
    const profile = await getCachedDeviceProfile();
    expect(profile.totalMemoryBytes).toBe(TWELVE_GIB);
    expect(profile.ramTier).toBe("high");
    expect(profile.socModel).toBeNull();
    expect(profile.socManufacturer).toBeNull();
  });
});

describe("buildDeviceProfile on Android makes no Apple class", () => {
  beforeEach(() => {
    mockPlatform.OS = "android";
    __resetDeviceProfileCacheForTests();
    mockAvailableMemoryBytes.mockReset();
    mockExpoDevice.brand = "samsung";
    mockExpoDevice.manufacturer = "samsung";
    mockExpoDevice.modelName = "Galaxy S23";
    // An Android-style id: even if a build ever reported one, the Apple map
    // must not answer it (on real devices expo-device modelId is null here).
    mockExpoDevice.modelId = "SM-S911B";
    mockExpoDevice.totalMemory = null;
    mockExpoDevice.osName = "Android";
    mockExpoDevice.osVersion = "15";
    mockExpoDevice.deviceType = 1;
    mockReadAsString.mockRejectedValue(new Error("no /proc in harness"));
  });

  it("reports the Expo reads only — no chip class, no nominal RAM", async () => {
    const profile = await getCachedDeviceProfile();
    expect(profile.totalMemoryBytes).toBeNull();
    expect(profile.ramTier).toBe("low");
    expect(profile.socModel).toBeNull();
    expect(profile.socManufacturer).toBeNull();
  });

  it("refuses every Apple model id — the guard is the platform, not the id", async () => {
    // expo-device reports no modelId on Android, but the guard must not rely
    // on that: these are the ids the Apple map would otherwise answer.
    for (const modelId of [
      "SM-S911B",
      "Mac15,6",
      "MacBookPro18,3",
      "iPhone18,1",
      "iPad16,6",
    ]) {
      __resetDeviceProfileCacheForTests();
      mockExpoDevice.modelId = modelId;
      const profile = await getCachedDeviceProfile();
      expect(profile.socModel).toBeNull();
      expect(profile.socManufacturer).toBeNull();
      expect(profile.totalMemoryBytes).toBeNull();
    }
  });

  it("carries an unreadable MemAvailable as null, never a fabricated 0", async () => {
    const profile = await getCachedDeviceProfile();
    expect(profile.availableMemoryBytes).toBeNull();
  });
});

describe("modelGateVerdict with a 0 available reading (iOS)", () => {
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

describe("Android pins origin/main 0-semantics (zero is real on iOS only)", () => {
  const base = {
    totalMemoryBytes: null as number | null,
    availableMemoryBytes: 0,
    freeDiskBytes: 100_000_000_000,
    ramTier: "high" as const,
    modelSizeBytes: 1_000_000_000,
  };
  const model = {
    sizeBytes: 1_000_000_000,
    engineCtx: 8192,
    kvBytesPerToken: null,
    mmproj: null,
  };

  beforeEach(() => {
    mockPlatform.OS = "android";
  });

  it("modelGateVerdict: a 0 available read gates nothing and stays unknown", () => {
    const verdict = modelGateVerdict({ ...base, modelNonEvictableMiB: 500 });
    expect(verdict.allowed).toBe(true);
    expect(verdict.reason).toBe("unknown");
  });

  it("modelGateVerdict: known through totalMemory, exactly as origin/main", () => {
    const verdict = modelGateVerdict({
      ...base,
      totalMemoryBytes: TWELVE_GIB,
      modelNonEvictableMiB: 500,
    });
    expect(verdict.allowed).toBe(true);
    expect(verdict.reason).toBe("ok");
  });

  it("evaluateModelFit / decidePreSendFit fail open at 0 available", () => {
    expect(evaluateModelFit(model, 0).verdict).toBe("unknown");
    expect(decidePreSendFit(model, 0)).toEqual({
      allow: true,
      bannerKey: "model.memoryUnknown",
    });
  });

  it("positive budgets still gate exactly as origin/main", () => {
    expect(evaluateModelFit(model, 100 * 1024 * 1024).verdict).toBe(
      "does_not_fit",
    );
  });
});

describe("fit paths with a 0 available reading (iOS)", () => {
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
