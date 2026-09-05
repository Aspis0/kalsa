import {
  recommendedModelId,
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