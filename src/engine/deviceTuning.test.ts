import { resolveEngineTuningSync, resolveGateContextTokens, type ProvenanceSource } from "./deviceTuning";

const profile = {
  brand: "test",
  modelName: "test",
  modelId: "test",
  osName: "Android",
  cpuCoreCount: 4,
  availableMemoryBytes: 1024 * 1024 * 1024,
  totalMemoryBytes: 4_000_000_000,
};

const baseModel = {
  id: "model-without-size-token",
  sizeBytes: 1,
  engineCtx: 2048,
  contextLength: 4096,
  kvCache: { k: "q8_0", v: "q4_0" },
};

describe("device tuning size-class policy", () => {
  it("uses sizeClass for the 4B thermal guard", () => {
    const result = resolveEngineTuningSync({
      model: { ...baseModel, sizeClass: "4B" },
      profile,
      request: {},
      platformHint: "android",
      resolvedThreads: 4,
    });

    expect(result.thermal).toEqual({
      maxDecodeSeconds: 60,
      guardSource: "measured:thermal-4b",
    });
  });

  it("ignores an id token when sizeClass is not 4B", () => {
    const result = resolveEngineTuningSync({
      model: { ...baseModel, id: "legacy-4b-name", sizeClass: "2B" },
      profile,
      request: {},
      platformHint: "android",
      resolvedThreads: 4,
    });

    expect(result.thermal).toEqual({ guardSource: "none" });
  });
});

/** LFM2.5 2.6B as the catalog carries it: 1520 MiB file, 6656 B/token KV. */
const LFM = {
  id: "lfm2.5-2.6b",
  sizeBytes: 1_593_894_944,
  engineCtx: 8192,
  contextLength: 131072,
  kvBytesPerToken: 6656,
};

const device = (availableMiB: number, totalBytes = 12_000_000_000) => ({
  brand: "test",
  cpuCoreCount: 8,
  availableMemoryBytes: availableMiB * 1024 * 1024,
  totalMemoryBytes: totalBytes,
});

describe("resolveGateContextTokens", () => {
  it("charges the context the budget will load, never the raw request", () => {
    // At 1.7 GiB available the repack + compute + 100k KV (2259 MiB) cannot
    // fit, so the gate must charge what the binary search will load — a raw
    // 102400 charge is what refuses a load that would have degraded instead.
    const charged = resolveGateContextTokens({
      model: LFM,
      profile: device(1700),
      requestedContextTokens: 102400,
    });
    expect(charged).toBeGreaterThanOrEqual(8192);
    expect(charged).toBeLessThan(102400);
  });

  it("charges the whole request when it fits", () => {
    expect(
      resolveGateContextTokens({
        model: LFM,
        profile: device(6000),
        requestedContextTokens: 102400,
      }),
    ).toBe(102400);
  });

  it("prices the bench:engine mmap lever, not only the policy default", () => {
    // mmap off makes the weights anonymous at 1.32x the file instead of a
    // 0.895x repack copy, so the same request resolves to a smaller context.
    // Ignoring the lever would charge ~150 MiB less than init allocates.
    const withMmap = resolveGateContextTokens({
      model: LFM,
      profile: device(2500),
      requestedContextTokens: 102400,
      benchUseMmap: true,
    });
    const withoutMmap = resolveGateContextTokens({
      model: LFM,
      profile: device(2500),
      requestedContextTokens: 102400,
      benchUseMmap: false,
    });
    expect(withMmap).toBe(102400);
    expect(withoutMmap).toBeLessThan(withMmap);
  });
});

describe("provenance sources", () => {
  it("accepts the floor tag at any floor the code can emit", () => {
    // ctxSource is `floor:${effectiveFloor}`, and effectiveFloor is the model's
    // own maximum when that sits below CTX_FLOOR (a 4k model). The fixed array
    // cannot list that, so the TYPE carries the parameterised form — this
    // assignment is what fails if it stops doing so.
    const floorTags: ProvenanceSource[] = [
      "floor:8192",
      "floor:4096",
      "memory-budget",
      "request",
    ];
    expect(floorTags).toContain("floor:4096");
  });
});

describe("a model shorter than the 8192 floor", () => {
  // devModelCatalog's OLMoE: engineCtx and contextLength are both 4096.
  const short = {
    id: "dev-olmoe",
    sizeBytes: 1_000_000_000,
    engineCtx: 4096,
    contextLength: 4096,
    kvBytesPerToken: 1024,
  };

  it("is never asked for 8192 (the floor cannot exceed the model's maximum)", () => {
    const result = resolveEngineTuningSync({
      model: short,
      profile: device(64 * 1024),
      request: { contextBudget: 100_000 },
      platformHint: "android",
      resolvedThreads: 4,
    });
    expect(result.context.n_ctx).toBe(4096);
  });
});
