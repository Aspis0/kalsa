import { MODEL_REGISTRY } from "./ModelRegistry";
import { resolveModelArtifact } from "./modelHost";

describe("resolveModelArtifact", () => {
  test("uses the pinned upstream source for a published model", () => {
    const model = MODEL_REGISTRY.find((entry) => entry.id === "lfm2.5-2.6b");
    expect(model).toBeDefined();
    expect(resolveModelArtifact(model!)).toEqual({
      status: "published",
      hfRepo: "LiquidAI/LFM2.5-2.6B-GGUF",
      revision: "f4a289c8a200a5ca71005ba7abc2dad33058a450",
    });
  });

  test("uses an explicit repository for an mmproj artifact", () => {
    const model = MODEL_REGISTRY.find((entry) => entry.id === "qwen3.5-4b");
    expect(model?.mmproj).toBeDefined();
    expect(resolveModelArtifact(model!, model!.mmproj)).toEqual({
      status: "published",
      hfRepo: "unsloth/Qwen3.5-4B-GGUF",
      revision: "e87f176479d0855a907a41277aca2f8ee7a09523",
    });
  });

  test("declares an owned artifact unpublished while the org is unset", () => {
    const model = MODEL_REGISTRY.find((entry) => entry.id === "lfm2.5-8b-a1b-kexp");
    expect(model).toBeDefined();
    expect(resolveModelArtifact(model!)).toEqual({
      status: "unpublished",
      artifact: "LFM2.5-8B-A1B-KEXP.gguf",
      owner: "kalsa",
    });
  });
});
