/**
 * The three dependency objects the lifted halves consume, assembled in one
 * place from what the root owns — one named field each where the old
 * component spread these across four dependency arrays, one memo and a dozen
 * refs.
 *
 * Build order the root must keep: `buildAgentDeps` → `buildAgentOptions`
 * (the tool options need only host-owned refs) → `buildTurnDeps` (the turn
 * binds its ensure through the dispatch ref shared with boot and switchers).
 */
import type { ConversationsState } from "../conversations/ConversationsStore";
import type { PersonasPersisted } from "../conversations/PersonasStore";
import type { LibraryState } from "../documents/DocumentLibrary";
import type { ContextMode } from "../context/compactor";
import type { DecodeMeasurement } from "../engine/deviceThroughput";
import type { EngineTurnOptions } from "../engine/LlamaService";
import type { ModelInfo } from "../engine/ModelRegistry";
import type { MemoryFact } from "../memory/MemoryStore";
import type { Locale, TranslateFn } from "../i18n";
import type { AgentOptionsDeps } from "./agentTurnOptions";
import type { EngineTurnDeps } from "./engineTurnDeps";
import { createTurnEnsure } from "./turnEnsureDispatch";
import { bumpForegroundIdleRef } from "../app/foregroundIdleDispose";
import type { LocalAttachment } from "./hostMessage";

/** Everything the root owns that any of the three halves reads. */
export interface HostDepsInput {
  t: TranslateFn;
  locale: Locale;
  thermalHardGateRef: { current: boolean };
  thermalHardGated: boolean;
  streamInFlightRef: { current: boolean };
  nativeTurnStartAtRef: { current: number };
  conversationsRef: { current: ConversationsState };
  memoryExtractRef: { current: Promise<void> | null };
  memoryExtractCancelRef: { current: (() => void) | null };
  memoryEnabledRef: { current: boolean };
  memoryFactsRef: { current: MemoryFact[] };
  injectedFactsRef: { current: string[] };
  setMemoryFacts: (facts: MemoryFact[]) => void;
  refreshMemoryFacts: () => Promise<void>;
  lastUserRawRef: { current: string };
  activeDocumentAttachmentRef: { current: LocalAttachment | null };
  onMiniappRef: { current: (miniapp: unknown) => void };
  toolhelpRef: { current: boolean };
  contextModeRef: { current: ContextMode };
  compactionEnabledRef: { current: boolean };
  documentLibraryRef: { current: LibraryState };
  embedderDownloadedRef: { current: boolean };
  personasStateRef: { current: PersonasPersisted };
  activePersonaIdRef: { current: string };
  webToolsEnabled: boolean;
  deviceToolsEnabled: boolean;
  calendarToolsEnabled: boolean;
  webToolsEnabledRef: { current: boolean };
  deviceToolsEnabledRef: { current: boolean };
  calendarToolsEnabledRef: { current: boolean };
  currentModel: ModelInfo;
  ensureEngineForModelRef: { current: (model: ModelInfo) => Promise<boolean> };
  remoteErrorRef: { current: string | null };
  chatEngineCtxRef: { current: number };
  recordDecodeSample: (model: ModelInfo, sample: DecodeMeasurement) => void;
  agentOptions: EngineTurnOptions;
  agentOptionsRef: { current: EngineTurnOptions };
  setStreaming: (streaming: boolean) => void;
}

/** The subset `buildAgentOptions` reads — narrow so the root can pass a
 *  literal before the model host (which owns the load deps) exists. */
export type AgentDepsInput = Pick<
  HostDepsInput,
  | "locale"
  | "webToolsEnabled"
  | "deviceToolsEnabled"
  | "calendarToolsEnabled"
  | "webToolsEnabledRef"
  | "deviceToolsEnabledRef"
  | "calendarToolsEnabledRef"
  | "documentLibraryRef"
  | "activeDocumentAttachmentRef"
  | "chatEngineCtxRef"
  | "embedderDownloadedRef"
  | "thermalHardGateRef"
  | "onMiniappRef"
  | "lastUserRawRef"
  | "toolhelpRef"
  | "injectedFactsRef"
>;

export function buildAgentDeps(input: AgentDepsInput): AgentOptionsDeps {
  return {
    locale: input.locale,
    webToolsEnabled: input.webToolsEnabled,
    deviceToolsEnabled: input.deviceToolsEnabled,
    calendarToolsEnabled: input.calendarToolsEnabled,
    webToolsEnabledRef: input.webToolsEnabledRef,
    deviceToolsEnabledRef: input.deviceToolsEnabledRef,
    calendarToolsEnabledRef: input.calendarToolsEnabledRef,
    documentLibraryRef: input.documentLibraryRef,
    activeDocumentAttachmentRef: input.activeDocumentAttachmentRef,
    chatEngineCtxRef: input.chatEngineCtxRef,
    embedderDownloadedRef: input.embedderDownloadedRef,
    thermalHardGateRef: input.thermalHardGateRef,
    onMiniappRef: input.onMiniappRef,
    lastUserRawRef: input.lastUserRawRef,
    toolhelpRef: input.toolhelpRef,
    injectedFactsRef: input.injectedFactsRef,
  };
}

/**
 * The engine half's deps. Its ensure callback uses the dispatch ref shared
 * with boot and switchers, so a remote model never reaches the local loader.
 */
export function buildTurnDeps(
  input: HostDepsInput,
): EngineTurnDeps {
  return {
    t: input.t,
    locale: input.locale,
    thermalHardGateRef: input.thermalHardGateRef,
    thermalHardGated: input.thermalHardGated,
    setStreaming: input.setStreaming,
    streamInFlightRef: input.streamInFlightRef,
    nativeTurnStartAtRef: input.nativeTurnStartAtRef,
    // The real module ref: its default is the no-op until the host's
    // foreground-idle governor (`foregroundIdle.ts`) mounts and assigns the
    // real clock — engineTurn's bump at `engineTurn.ts:134` is its only reader.
    bumpForegroundIdleRef,
    lastUserRawRef: input.lastUserRawRef,
    activeDocumentAttachmentRef: input.activeDocumentAttachmentRef,
    onMiniappRef: input.onMiniappRef,
    memoryExtractRef: input.memoryExtractRef,
    memoryExtractCancelRef: input.memoryExtractCancelRef,
    memoryEnabledRef: input.memoryEnabledRef,
    memoryFactsRef: input.memoryFactsRef,
    injectedFactsRef: input.injectedFactsRef,
    setMemoryFacts: input.setMemoryFacts,
    refreshMemoryFacts: input.refreshMemoryFacts,
    ensureEngineForModel: createTurnEnsure(input.ensureEngineForModelRef),
    currentModel: input.currentModel,
    remoteErrorRef: input.remoteErrorRef,
    documentLibraryRef: input.documentLibraryRef,
    agentOptionsRef: input.agentOptionsRef,
    agentOptions: input.agentOptions,
    chatEngineCtxRef: input.chatEngineCtxRef,
    conversationsRef: input.conversationsRef,
    personasStateRef: input.personasStateRef,
    activePersonaIdRef: input.activePersonaIdRef,
    recordDecodeSample: input.recordDecodeSample,
    contextModeRef: input.contextModeRef,
    compactionEnabledRef: input.compactionEnabledRef,
    toolhelpRef: input.toolhelpRef,
  };
}
