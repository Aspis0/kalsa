import { resolveEngineTuningSync } from "./deviceTuning";

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
