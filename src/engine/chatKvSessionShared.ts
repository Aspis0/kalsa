import {
  getSessionConversationId, readPersistedHistoryLength,
  sessionNativeErrorReason, GOVERNOR_SESSION_REASON,
} from "./sessionPersistence";
import { sessionStem } from "./sessionKey";
import {
  sessionBytesPerTokenForModel, type SessionDiskCalibration,
} from "./sessionDiskCalibration";
import { loadSessionDiskCalibration } from "./sessionDiskCalibrationStore";
import { registrySessionBytesPerToken } from "./sessionDiskFallback";
import type { ChatKvSessionState } from "./chatKvSessionState";

/** Helpers both KV-session paths need; they take the state because their inputs live in LlamaService. */
export function activeSessionStem(
  state: ChatKvSessionState,
  modelId: string,
  conversationId?: string,
  promptEnvHash?: string,
): string | null {
  const conv = conversationId ?? getSessionConversationId();
  const env = promptEnvHash ?? state.lastPromptEnvHash;
  if (!conv || !env) return null;
  return sessionStem(modelId, conv, env);
}

/** Telemetry-safe error tag (name/enum only — never message/path/user data). */
export function sessionErrorReason(error: unknown): string {
  const native = sessionNativeErrorReason(error);
  if (native) return native;
  const raw =
    error instanceof Error
      ? error.name || "Error"
      : typeof error === "string"
        ? "string"
        : "unknown";
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, "").slice(0, 40);
  return `error:${cleaned || "unknown"}`;
}

/** Record chat KV used tokens. 0 / non-finite clears (empty or unknown). */
export function noteChatNPast(
  state: ChatKvSessionState,
  value: unknown,
): void {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    state.lastChatNPast = Math.floor(value);
    return;
  }
  if (value === 0) state.lastChatNPast = undefined;
}

export async function sessionDiskGateInput(
  state: ChatKvSessionState,
  modelId = state.activeModelId ?? "",
): Promise<{
  nPast?: number;
  historyLength?: number | null;
  nCtx: number;
  bytesPerToken: number | null;
  calibration: SessionDiskCalibration;
}> {
  const nPast = state.lastChatNPast;
  let historyLength: number | null | undefined;
  if (nPast == null || nPast <= 0) {
    historyLength = await readPersistedHistoryLength();
  }
  const calibration = await loadSessionDiskCalibration();
  return {
    nPast,
    historyLength,
    nCtx: state.activeEngineCtx,
    bytesPerToken: sessionBytesPerTokenForModel(
      calibration,
      modelId,
      registrySessionBytesPerToken(modelId, state.activeCacheTypeK, state.activeCacheTypeV),
      state.activeCacheTypeK,
      state.activeCacheTypeV,
    ),
    calibration,
  };
}

export function logGovernorSessionSkip(): void {
  try {
    console.log(
      `KALSA_SESSION ${JSON.stringify({
        op: "save",
        ok: false,
        reason: GOVERNOR_SESSION_REASON,
      })}`,
    );
  } catch {
    // telemetry must never throw
  }
}
