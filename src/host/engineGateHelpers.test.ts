/**
 * profileWithFreshMemory platform pins: on iOS a fresh 0 sample replaces the
 * cached profile value (os_proc_available_memory 0 = at/over the jetsam
 * limit); on Android a 0 keeps its origin/main "unknown" meaning, so the
 * cached sample stands. The Android read below goes through the real monitor
 * reader (mocked expo-file-system) returning exactly 0, so the pin covers the
 * pathological 0 kB MemAvailable case end to end.
 */
const mockPlatform = { OS: "ios" };
jest.mock("react-native", () => ({ Platform: mockPlatform }));

const mockAvailableMemoryBytes = jest.fn<Promise<number | null>, []>();
jest.mock("../../modules/kalsa-lifecycle/src", () => ({
  getOsAvailableMemoryBytes: () => mockAvailableMemoryBytes(),
}));

const mockReadAsString = jest.fn<Promise<string>, [string]>();
jest.mock("expo-file-system/legacy", () => ({
  readAsStringAsync: (uri: string) => mockReadAsString(uri),
}));

// engineGateHelpers pulls llama.rn transitively (EmbeddingService, module
// scope); the helper under test never calls into it.
jest.mock("../engine/EmbeddingService", () => ({
  EMBEDDER_RELEASE_TIMEOUT_MS: 1_000,
  markEmbedderHung: () => {},
  releaseEmbedder: async () => {},
}));

import { profileWithFreshMemory } from "./engineGateHelpers";
import type { DeviceProfile } from "../engine/deviceProfile";

const cachedProfile = (availableMemoryBytes: number | null): DeviceProfile => ({
  brand: null,
  manufacturer: null,
  modelName: null,
  modelId: null,
  totalMemoryBytes: 12_000_000_000,
  availableMemoryBytes,
  socModel: null,
  socManufacturer: null,
  osName: null,
  osVersion: null,
  cpuCoreCount: 8,
  cpuCapacities: null,
  ramTier: "high",
  family: "generic",
  isMiuiFamily: false,
  isFoldableCandidate: false,
  isTablet: false,
});

describe("profileWithFreshMemory", () => {
  it("replaces the cached sample with a fresh 0 on iOS", async () => {
    mockPlatform.OS = "ios";
    mockAvailableMemoryBytes.mockResolvedValueOnce(0);
    const next = await profileWithFreshMemory(cachedProfile(4_000_000_000));
    expect(next.availableMemoryBytes).toBe(0);
  });

  it("keeps the cached sample when the Android read is 0 (origin/main)", async () => {
    mockPlatform.OS = "android";
    // Pathological 0 kB MemAvailable: still "unknown" off iOS.
    mockReadAsString.mockResolvedValue("MemAvailable:         0 kB");
    const next = await profileWithFreshMemory(cachedProfile(4_000_000_000));
    expect(next.availableMemoryBytes).toBe(4_000_000_000);
  });

  it("still replaces the sample with a positive fresh read on Android", async () => {
    mockPlatform.OS = "android";
    mockReadAsString.mockResolvedValue("MemAvailable:     868000 kB");
    const next = await profileWithFreshMemory(cachedProfile(null));
    expect(next.availableMemoryBytes).toBe(868_000 * 1024);
  });

  it("keeps the cached sample when the iOS read does not exist", async () => {
    mockPlatform.OS = "ios";
    mockAvailableMemoryBytes.mockResolvedValueOnce(null);
    const next = await profileWithFreshMemory(cachedProfile(4_000_000_000));
    expect(next.availableMemoryBytes).toBe(4_000_000_000);
  });
});
