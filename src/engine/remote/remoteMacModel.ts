import type { ModelInfo } from "../ModelRegistry";

export const REMOTE_MAC_MODEL_ID = "kalsa-remote-mac";

/** Virtual catalog row for the Mac mtplx brain. Not in MODEL_REGISTRY. */
export const REMOTE_MAC_MODEL: ModelInfo = {
  id: REMOTE_MAC_MODEL_ID,
  name: "Il mio Mac",
  vendor: "Kalsa",
  quant: "remote",
  hfRepo: "local/remote-brain",
  revision: "none",
  file: "",
  sizeBytes: 0,
  contextLength: 262144,
  engineCtx: 32768,
  kvCache: { k: "q8_0", v: "q4_0" },
  sizeClass: "other",
  thinking: { short: 1024, extended: 4096, nPredict: 4096 },
  descriptionKey: "models.remoteMac.description",
  listed: false,
};

export function isRemoteMacModelId(id: string | null | undefined): boolean {
  return id === REMOTE_MAC_MODEL_ID;
}
