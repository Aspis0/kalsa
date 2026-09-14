/**
 * Engine selector. Default backend is local llama.rn (zero regression).
 * Remote is the Mac mtplx OpenAI server. UI imports this module instead of
 * LlamaService at AppShell / AiChatPage only.
 */
import type { EngineLivenessVerdict } from "./engineLiveness";
import {
  chatKvIsHeld as localChatKvIsHeld,
  completeOnce as localCompleteOnce,
  discardChatKvForWindowSlide as localDiscardChatKv,
  disposeEngine as localDisposeEngine,
  extractMemory as localExtractMemory,
  getActiveEngineNCtx as localGetActiveEngineNCtx,
  getActiveModelId as localGetActiveModelId,
  getEngineLostModelId as localGetEngineLostModelId,
  getLoadedAssembleBoundary as localGetLoadedAssembleBoundary,
  initEngine as localInitEngine,
  invalidateConversationSessions as localInvalidateConversationSessions,
  invalidateEngineSession as localInvalidateEngineSession,
  isEngineLostRecovery as localIsEngineLostRecovery,
  isEngineReady as localIsEngineReady,
  markKvNonReproducible as localMarkKvNonReproducible,
  nativeEngineWorkInFlight as localNativeWorkInFlight,
  notifyStaticPrefixInputs as localNotifyStaticPrefixInputs,
  probeAndReconcileEngine as localProbeAndReconcileEngine,
  queueStaticPrefixPrewarm as localQueueStaticPrefixPrewarm,
  restoreEngineSession as localRestoreEngineSession,
  saveEngineSession as localSaveEngineSession,
  streamAssistantTurn as localStreamAssistantTurn,
  translateText as localTranslateText,
  type CompleteOnceOpts,
  type EngineCallbacks,
  type EngineInitOptions,
  type EngineInitResult,
  type EngineMessage,
  type MemoryExtractResult,
  type StreamTurnOptions,
} from "./LlamaService";
import {
  disposeRemoteEngine,
  initRemoteEngine,
  isRemoteEngineReady,
  remoteCompleteOnce,
  remoteExtractMemory,
  remoteInvalidateConversationSessions,
  remoteInvalidateEngineSession,
  remoteNativeWorkInFlight,
  remoteRestoreEngineSession,
  remoteSaveEngineSession,
  remoteTranslateText,
  streamRemoteAssistantTurn,
} from "./remote/RemoteEngine";
import { REMOTE_MAC_MODEL_ID } from "./remote/remoteMacModel";
import {
  getEngineBackendMode,
  getRemoteContextSize,
  isRemoteEngineBackend,
  type EngineBackendMode,
} from "./remote/remoteSettings";

export type {
  EngineCallbacks,
  EngineInitOptions,
  EngineInitResult,
  EngineMessage,
  EngineToolResult,
  EngineTurnOptions,
  MemoryExtractResult,
  MemoryExtractStopReason,
  StreamTurnOptions,
} from "./LlamaService";

export {
  beginBackendSwitch,
  endBackendSwitch,
  hydrateRemoteBrainSettings,
  isOrphanRemoteWithoutUrl,
  isRemoteEngineBackend,
  recoverLocalBackend,
  setEngineBackendMode,
  setRemoteServerModelId,
} from "./remote/remoteSettings";
export { REMOTE_MAC_MODEL, REMOTE_MAC_MODEL_ID } from "./remote/remoteMacModel";
export {
  disposeRemoteEngine,
  isSupersededRemoteOp,
  testRemoteConnection,
} from "./remote/RemoteEngine";

export function isEngineReady(): boolean {
  return isRemoteEngineBackend() ? isRemoteEngineReady() : localIsEngineReady();
}

export function getActiveModelId(): string | null {
  if (!isRemoteEngineBackend()) return localGetActiveModelId();
  return isRemoteEngineReady() ? REMOTE_MAC_MODEL_ID : null;
}

export function getActiveEngineNCtx(): number {
  if (!isRemoteEngineBackend()) return localGetActiveEngineNCtx();
  return isRemoteEngineReady() ? getRemoteContextSize() : 0;
}

export function nativeEngineWorkInFlight(): boolean {
  return isRemoteEngineBackend()
    ? remoteNativeWorkInFlight()
    : localNativeWorkInFlight();
}

export function chatKvIsHeld(): boolean {
  return isRemoteEngineBackend() ? false : localChatKvIsHeld();
}

export function getLoadedAssembleBoundary(activeChatId: string): number | null {
  return isRemoteEngineBackend()
    ? null
    : localGetLoadedAssembleBoundary(activeChatId);
}

export function isEngineLostRecovery(modelId?: string): boolean {
  return isRemoteEngineBackend() ? false : localIsEngineLostRecovery(modelId);
}

export function getEngineLostModelId(): string | null {
  return isRemoteEngineBackend() ? null : localGetEngineLostModelId();
}

export function markKvNonReproducible(
  event?: Parameters<typeof localMarkKvNonReproducible>[0],
): void {
  if (isRemoteEngineBackend()) return;
  localMarkKvNonReproducible(event);
}

export function notifyStaticPrefixInputs(
  ...args: Parameters<typeof localNotifyStaticPrefixInputs>
): void {
  if (isRemoteEngineBackend()) return;
  localNotifyStaticPrefixInputs(...args);
}

export function queueStaticPrefixPrewarm(
  ...args: Parameters<typeof localQueueStaticPrefixPrewarm>
): void {
  if (isRemoteEngineBackend()) return;
  localQueueStaticPrefixPrewarm(...args);
}

export function discardChatKvForWindowSlide(
  ...args: Parameters<typeof localDiscardChatKv>
): ReturnType<typeof localDiscardChatKv> {
  if (isRemoteEngineBackend()) return Promise.resolve(false);
  return localDiscardChatKv(...args);
}

export function initEngine(
  modelPath: string,
  modelId: string,
  options: EngineInitOptions & { backend?: EngineBackendMode },
): Promise<EngineInitResult> {
  const { backend: explicit, ...rest } = options;
  const backend = explicit ?? getEngineBackendMode();
  if (backend === "remote") {
    return initRemoteEngine(modelPath, modelId, rest);
  }
  return localInitEngine(modelPath, modelId, rest);
}

export function disposeEngine(): Promise<void> {
  if (isRemoteEngineBackend()) return disposeRemoteEngine();
  return localDisposeEngine();
}

export function streamAssistantTurn(
  messages: EngineMessage[],
  callbacks: EngineCallbacks,
  signal: AbortSignal | undefined,
  options: StreamTurnOptions & { backend?: EngineBackendMode },
): Promise<void> {
  const { backend: explicit, ...rest } = options;
  const backend = explicit ?? getEngineBackendMode();
  if (backend === "remote") {
    return streamRemoteAssistantTurn(messages, callbacks, signal, rest);
  }
  return localStreamAssistantTurn(messages, callbacks, signal, rest);
}

export function saveEngineSession(
  ...args: Parameters<typeof localSaveEngineSession>
): Promise<boolean> {
  if (isRemoteEngineBackend()) return remoteSaveEngineSession();
  return localSaveEngineSession(...args);
}

export function restoreEngineSession(
  ...args: Parameters<typeof localRestoreEngineSession>
): Promise<boolean> {
  if (isRemoteEngineBackend()) return remoteRestoreEngineSession();
  return localRestoreEngineSession(...args);
}

export function invalidateEngineSession(
  ...args: Parameters<typeof localInvalidateEngineSession>
): Promise<void> {
  if (isRemoteEngineBackend()) return remoteInvalidateEngineSession();
  return localInvalidateEngineSession(...args);
}

export function invalidateConversationSessions(
  ...args: Parameters<typeof localInvalidateConversationSessions>
): Promise<void> {
  if (isRemoteEngineBackend()) return remoteInvalidateConversationSessions();
  return localInvalidateConversationSessions(...args);
}

export function extractMemory(
  ...args: Parameters<typeof localExtractMemory>
): Promise<MemoryExtractResult> {
  if (isRemoteEngineBackend()) return Promise.resolve(remoteExtractMemory());
  return localExtractMemory(...args);
}

export function translateText(
  ...args: Parameters<typeof localTranslateText>
): ReturnType<typeof localTranslateText> {
  if (isRemoteEngineBackend()) return remoteTranslateText();
  return localTranslateText(...args);
}

export function completeOnce(
  opts: CompleteOnceOpts,
): ReturnType<typeof localCompleteOnce> {
  if (isRemoteEngineBackend()) return remoteCompleteOnce();
  return localCompleteOnce(opts);
}

export async function probeAndReconcileEngine(opts?: {
  busy?: boolean;
}): Promise<EngineLivenessVerdict> {
  if (isRemoteEngineBackend()) {
    return isRemoteEngineReady() ? { status: "alive" } : { status: "absent" };
  }
  return localProbeAndReconcileEngine(opts);
}
