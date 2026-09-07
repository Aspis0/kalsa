import { MODEL_REGISTRY, getDefaultModel } from "./ModelRegistry";
import { recommendedModelId, type RamTier } from "./contextProfile";

const RAM_TIERS: RamTier[] = ["low", "mid", "high"];

describe("MODEL_REGISTRY catalog invariants", () => {
  it("has exactly one listed recommendation for every RAM tier", () => {
    for (const tier of RAM_TIERS) {
      const candidates = MODEL_REGISTRY.filter(
        (model) =>
          model.listed !== false && model.recommendForTiers?.includes(tier) === true,
      );
      expect(candidates).toHaveLength(1);
      expect(recommendedModelId(tier)).toBe(candidates[0]?.id);
    }
  });

  it("keeps the default model and size metadata declarative", () => {
    expect(getDefaultModel().id).toBe("qwen3.5-4b");
    expect(
      MODEL_REGISTRY.every(
        (model) => model.listed === false || model.sizeClass !== undefined,
      ),
    ).toBe(true);
  });

  it("does not allow hidden entries to win recommendations", () => {
    const lowModel = MODEL_REGISTRY.find((model) => model.recommendForTiers?.includes("low"));
    expect(lowModel).toBeDefined();
    expect(
      recommendedModelId("low", [{ ...lowModel!, listed: false }]),
    ).toBeNull();
  });
});
