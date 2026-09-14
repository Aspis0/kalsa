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
      reason: "orphan" | "hydration-failed" | "saved-local";
    };

export function decideRemoteBoot(input: {
  hydrationOk: boolean;
  backend: EngineBackendMode;
  url: string;
  savedModelId: string | null;
  defaultLocalModelId: string;
  remoteModelId: string;
}): RemoteBootDecision {
  const urlReady = input.url.trim().length > 0;
  if (!input.hydrationOk) {
    return {
      kind: "local",
      persistModelId: input.defaultLocalModelId,
      reason: "hydration-failed",
    };
  }
  const savedWantsRemote = input.savedModelId === input.remoteModelId;
  const wantsRemote = input.backend === "remote" || savedWantsRemote;
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
