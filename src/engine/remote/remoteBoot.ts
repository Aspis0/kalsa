/**
 * Single source of truth for boot: model id and backend cannot disagree.
 * Remote only if hydration succeeded AND a usable URL is present.
 */
import type { EngineBackendMode } from "./remoteSettings";

export const CHAT_MODEL_STORAGE_KEY = "kalsa.model.id";

export type RemoteBootDecision =
  | { kind: "remote" }
  | {
      kind: "local";
      persistModelId: string;
      reason: "orphan" | "hydration-failed" | "stale-hydration" | "saved-local";
    };

export function decideRemoteBoot(input: {
  hydrationOk: boolean;
  /**
   * True when a newer hydration replaced this snapshot while the boot was
   * waiting (the user changed something in Settings, say). The values in hand
   * are then known to be obsolete, so the boot must not act on them: booting
   * remote on a snapshot whose URL was just cleared is exactly the false error
   * this guards against.
   */
  hydrationStale: boolean;
  backend: EngineBackendMode;
  url: string;
  savedModelId: string | null;
  defaultLocalModelId: string;
  remoteModelId: string;
}): RemoteBootDecision {
  const urlReady = input.url.trim().length > 0;
  if (!input.hydrationOk || input.hydrationStale) {
    return {
      kind: "local",
      persistModelId: input.defaultLocalModelId,
      reason: input.hydrationStale ? "stale-hydration" : "hydration-failed",
    };
  }
  // The backend key is the live choice; a model id alone never is. The model
  // id can be stale — the local model-id write can fail during a remote→local
  // switch while the backend write succeeds — and a stale REMOTE id must not
  // override the user's later local selection. With the backend key as the
  // single source of truth the two stores cannot flip-flop: boot only ever
  // writes that key as "local" (recoverLocalBackend), never back to remote.
  const wantsRemote = input.backend === "remote";
  if (wantsRemote && !urlReady) {
    return {
      kind: "local",
      persistModelId: input.defaultLocalModelId,
      reason: "orphan",
    };
  }
  if (wantsRemote) return { kind: "remote" };
  return {
    kind: "local",
    persistModelId:
      input.savedModelId && input.savedModelId !== input.remoteModelId
        ? input.savedModelId
        : input.defaultLocalModelId,
    reason: "saved-local",
  };
}
