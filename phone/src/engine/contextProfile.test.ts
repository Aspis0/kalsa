const mockPlatform = { OS: "ios" };
jest.mock("react-native", () => ({ Platform: mockPlatform }));

import {
  recommendedModelId,
  resolveContextProfile,
  type RamTier,
} from "./contextProfile";
import { isChatModel2BClass, isChatModel4BClass } from "./llamaContextGate";
import { MODEL_REGISTRY } from "./ModelRegistry";

/**
 * Data-driven tier recommendation — no hardcoded id in the recommendation path.
 * The binding lives on ModelInfo.recommendForTiers; this file pins the current
 * production mapping so a future catalog edit that drops it fails loudly.
 */
describe("recommendedModelId — current production mapping", () => {
  it("recommends qwen3.5-4b for the high tier", () => {
    expect(recommendedModelId("high")).toBe("qwen3.5-4b");
  });

  it("recommends lfm2.5-2.6b for the low and mid tiers", () => {
    expect(recommendedModelId("low")).toBe("lfm2.5-2.6b");
    expect(recommendedModelId("mid")).toBe("lfm2.5-2.6b");
  });

  it("returns null when no listed entry recommends a tier", () => {
    // A registry with no recommendForTiers yields no recommendation.
    expect(recommendedModelId("high", [])).toBeNull();
  });
});

describe("size-class classification via the catalog (no id-string parsing)", () => {
  it("classifies the LFM entry as 2B-class and the Qwen entry as 4B-class", () => {
    expect(isChatModel2BClass("lfm2.5-2.6b")).toBe(true);
    expect(isChatModel4BClass("qwen3.5-4b")).toBe(true);
  });

  it("does not classify an unknown id as the default model's class", () => {
    // getModelById falls back to the default for unknown ids; the classifier
    // must NOT inherit the default's sizeClass for a stale/unknown id.
    expect(isChatModel2BClass("does-not-exist-xyz")).toBe(false);
    expect(isChatModel4BClass("does-not-exist-xyz")).toBe(false);
  });

  it("every listed model declares a sizeClass", () => {
    const missing = MODEL_REGISTRY.filter((model) => model.listed !== false && !model.sizeClass);
    expect(missing).toHaveLength(0);
  });
});

/**
 * The KV pair the load runs. initEngine's cacheTypeK/V come from this
 * function's result on the load path, so both platform answers are pinned
 * here — the engineEnsureLoad call site passes it through unchanged.
 */
describe("resolveContextProfile — the KV pair the load runs", () => {
  const catalogPair = { k: "q8_0", v: "q4_0" } as const;
  const input = {
    hybrid: true,
    kvCache: catalogPair,
    catalogCtx: 8192,
    totalMemoryBytes: 8_000_000_000,
  };

  it("iOS: the catalog's mixed pair resolves to q8_0/q8_0", () => {
    mockPlatform.OS = "ios";
    const profile = resolveContextProfile(input);
    expect(profile.cacheTypeK).toBe("q8_0");
    expect(profile.cacheTypeV).toBe("q8_0");
  });

  it("Android: the same input keeps the catalog's pair", () => {
    mockPlatform.OS = "android";
    const profile = resolveContextProfile(input);
    expect(profile.cacheTypeK).toBe("q8_0");
    expect(profile.cacheTypeV).toBe("q4_0");
  });
});