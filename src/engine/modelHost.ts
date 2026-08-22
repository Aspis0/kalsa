import type { ModelFileSpec, ModelInfo } from "./ModelRegistry";

// Single switch: set our Hugging Face organisation when it exists to publish
// and download artifacts owned by Kalsa.
export const KALSA_HF_ORG: string | null = null;

type ModelArtifactResolution =
  | { status: "published"; hfRepo: string; revision: string }
  | { status: "unpublished"; artifact: string; owner: "kalsa" };

export function resolveModelArtifact(
  model: ModelInfo,
  spec?: ModelFileSpec,
): ModelArtifactResolution {
  if (spec?.hfRepo) {
    return {
      status: "published",
      hfRepo: spec.hfRepo,
      revision: spec.revision ?? model.revision,
    };
  }

  if (model.hfArtifactRepo) {
    if (KALSA_HF_ORG === null) {
      return {
        status: "unpublished",
        artifact: spec?.file ?? model.file,
        owner: "kalsa",
      };
    }
    return {
      status: "published",
      hfRepo: `${KALSA_HF_ORG}/${model.hfArtifactRepo}`,
      revision: "main",
    };
  }

  return {
    status: "published",
    hfRepo: model.hfRepo,
    revision: spec?.revision ?? model.revision,
  };
}
