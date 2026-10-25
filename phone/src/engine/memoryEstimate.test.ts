/**
 * os_proc_available_memory semantics on the memoryEstimate paths (P1 of the
 * ios/first-build audit): on iOS 0 is a REAL reading (app at/over its limit →
 * zero headroom) and null means the platform read does not exist — and the
 * iOS read must never be served from (or stored in) the process cache. On
 * Android a 0 keeps its origin/main "unknown" meaning: the zero-is-real scope
 * is the platform, never the estimator.
 */
const mockPlatform = { OS: "ios" };
jest.mock("react-native", () => ({ Platform: mockPlatform }));

const mockAvailableMemoryBytes = jest.fn<Promise<number | null>, []>();
jest.mock("../../modules/kalsa-lifecycle/src", () => ({
  getOsAvailableMemoryBytes: () => mockAvailableMemoryBytes(),
}));

import {
  estimateMemory,
  fitMemoryEstimate,
  getAvailableMemoryBytes,
  __resetAvailableMemoryCacheForTests,
} from "./memoryEstimate";

describe("fitMemoryEstimate on iOS", () => {
  const estimate = estimateMemory({
    fileBytes: 1_000 * 1024 * 1024,
    contextTokens: 8192,
    kvBytesPerToken: 0,
    ubatch: 256,
  });

  beforeEach(() => {
    mockPlatform.OS = "ios";
  });

  it("treats 0 MiB available as zero headroom, not unknown", () => {
    const fit = fitMemoryEstimate(estimate, 0);
    expect(fit.status).toBe("does_not_fit");
    expect(fit.availableMiB).toBe(0);
  });

  it("still judges positive budgets", () => {
    expect(fitMemoryEstimate(estimate, 100_000).status).toBe("fits");
    // nonEvictable ≈ 1144 MiB: inside [nonEvictable, nonEvictable+512) → tight.
    expect(fitMemoryEstimate(estimate, 1_300).status).toBe("tight");
  });

  it("stays unknown only for null / negative / non-finite budgets", () => {
    expect(fitMemoryEstimate(estimate, null).status).toBe("unknown");
    expect(fitMemoryEstimate(estimate, -1).status).toBe("unknown");
    expect(fitMemoryEstimate(estimate, Number.NaN).status).toBe("unknown");
  });
});

describe("fitMemoryEstimate on Android (origin/main 0-semantics pinned)", () => {
  const estimate = estimateMemory({
    fileBytes: 1_000 * 1024 * 1024,
    contextTokens: 8192,
    kvBytesPerToken: 0,
    ubatch: 256,
  });

  beforeEach(() => {
    mockPlatform.OS = "android";
  });

  it("treats a 0 budget as unknown, exactly as origin/main", () => {
    const fit = fitMemoryEstimate(estimate, 0);
    expect(fit.status).toBe("unknown");
    expect(fit.availableMiB).toBeNull();
  });

  it("judges positive budgets identically to iOS", () => {
    expect(fitMemoryEstimate(estimate, 100_000).status).toBe("fits");
    expect(fitMemoryEstimate(estimate, 1_300).status).toBe("tight");
  });
});

describe("getAvailableMemoryBytes on iOS", () => {
  beforeEach(() => {
    mockPlatform.OS = "ios";
    __resetAvailableMemoryCacheForTests();
    mockAvailableMemoryBytes.mockReset();
  });

  it("returns 0 unchanged (zero headroom), never folds it into null", async () => {
    mockAvailableMemoryBytes.mockResolvedValueOnce(0);
    await expect(getAvailableMemoryBytes()).resolves.toBe(0);
  });

  it("does not cache: successive reads observe fresh values", async () => {
    mockAvailableMemoryBytes.mockResolvedValueOnce(2_000_000_000);
    await expect(getAvailableMemoryBytes()).resolves.toBe(2_000_000_000);
    mockAvailableMemoryBytes.mockResolvedValueOnce(0);
    await expect(getAvailableMemoryBytes()).resolves.toBe(0);
    expect(mockAvailableMemoryBytes).toHaveBeenCalledTimes(2);
  });

  it("propagates null when the platform read does not exist", async () => {
    mockAvailableMemoryBytes.mockResolvedValueOnce(null);
    await expect(getAvailableMemoryBytes()).resolves.toBeNull();
  });
});
