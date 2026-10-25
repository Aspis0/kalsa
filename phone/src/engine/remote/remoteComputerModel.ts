import type { ModelInfo } from "../ModelRegistry";
import { DEFAULT_REMOTE_CTX } from "./remoteDefaults";

/**
 * The remote brain is whatever OpenAI-compatible server the user points the app
 * at: their own computer, whatever its operating system or runtime.
 *
 * The id VALUE stays "kalsa-remote-mac": it is persisted in AsyncStorage as the
 * selected model (MODEL_STORAGE_KEY), so changing it would orphan every
 * existing install. Only the symbol is neutral.
 */
export const REMOTE_COMPUTER_MODEL_ID = "kalsa-remote-mac";

/** Virtual catalog row for the user's computer. Not in MODEL_REGISTRY. */
export const REMOTE_COMPUTER_MODEL: ModelInfo = {
  id: REMOTE_COMPUTER_MODEL_ID,
  // Fallback display name; the machine label is localized separately.
  name: "Kalsa desktop",
  nameKey: "settings.remoteComputer",
  vendor: "Kalsa",
  quant: "remote",
  hfRepo: "local/remote-brain",
  revision: "none",
  file: "",
  sizeBytes: 0,
  // Our own default, used until the server tells us better: the probe reads
  // /props and the live budget follows the server's own n_ctx (see
  // RemoteEngine.testRemoteConnection). The client sends no context length, so
  // this is a promise about our request, not about the server.
  contextLength: DEFAULT_REMOTE_CTX,
  engineCtx: DEFAULT_REMOTE_CTX,
  kvCache: { k: "q8_0", v: "q4_0" },
  sizeClass: "other",
  thinking: { short: 1024, extended: 4096, nPredict: 4096 },
  descriptionKey: "models.remoteComputer.description",
  listed: false,
};

export function isRemoteComputerModelId(id: string | null | undefined): boolean {
  return id === REMOTE_COMPUTER_MODEL_ID;
}
