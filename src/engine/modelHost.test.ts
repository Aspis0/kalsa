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

  // Fixture, not a catalogue entry: this asserts the OWNED-ARTIFACT rule, and
  // pinning it to whichever model happens to carry hfArtifactRepo made it fail
  // the day the KEXP was dropped (2026-08-23) — a catalogue decision breaking a
  // test about resolver logic. Today no shipped model is our own artifact.
  test("declares an owned artifact unpublished while the org is unset", () => {
    const owned = {
      ...MODEL_REGISTRY.find((entry) => entry.id === "lfm2.5-2.6b")!,
      hfArtifactRepo: "SOME-OWN-REQUANT-GGUF",
      file: "SOME-OWN-REQUANT.gguf",
    };
    expect(resolveModelArtifact(owned)).toEqual({
      status: "unpublished",
      artifact: "SOME-OWN-REQUANT.gguf",
      owner: "kalsa",
    });
  });
});
