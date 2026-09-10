import { MODEL_REGISTRY, getDefaultModel } from "./ModelRegistry";
import { recommendedModelId, type RamTier } from "./contextProfile";
import { DEV_MODEL_REGISTRY } from "./devModelCatalog";

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

  it("declares MiniCPM5 as a dense, upstream-pinned experimental model", () => {
    const model = DEV_MODEL_REGISTRY.find((entry) => entry.id === "dev-minicpm5-2b");
    expect(model).toMatchObject({
      hfRepo: "openbmb/MiniCPM5-2B-GGUF",
      revision: "d00c954e5f9a0f2605468f24703ffa7e5cb0c492",
      file: "MiniCPM5-2B-Q4_K_M.gguf",
      sizeBytes: 1_561_318_368,
      sha256: "ec2d5801640099e97d8d7e8003ad4d81f336e757811f03a26173dddf386602fd",
      contextLength: 131072,
      engineCtx: 8192,
      kvCache: { k: "q8_0", v: "q4_0" },
      kvBytesPerToken: 17472,
      thinking: { short: 512, extended: 1024, nPredict: 2048 },
      sizeClass: "2B",
      minRamTier: "low",
    });
    expect(model?.hybrid).toBeUndefined();
    expect(model?.kvUnified).toBeUndefined();
    expect(model?.mmproj).toBeUndefined();
    expect(model?.preserveThinking).toBeUndefined();
  });
});
