/**
 * The engine-side dependency chain of the root: the tool options memo, the
 * model host and the engine half's deps, built in the only order they can
 * be (agent options need host refs; the model host needs the finished
 * options; the turn binds its load path through the model host's deps).
 * Split out of `HostRoot` purely for the file-size rule.
 */
import { useMemo, useRef } from "react";
import type { ConversationsState } from "../conversations/ConversationsStore";
import type { Locale, TranslateFn } from "../i18n";
import { buildAgentDeps, buildTurnDeps } from "./hostDeps";
import { buildAgentOptions } from "./agentTurnOptions";
import { useModelHost } from "./useModelHost";
import { useForegroundIdleDispose } from "./foregroundIdle";
import type { useMemoryHost } from "./memoryHost";
import type { usePersonasHost } from "./personasHost";
import type { useLibraryHost } from "./libraryHost";
import type { useToolFlags } from "./toolFlags";

export interface HostEngineParams {
  t: TranslateFn;
  locale: Locale;
  thermalHardGateRef: { current: boolean };
  thermalHardGated: boolean;
  setStreaming: (streaming: boolean) => void;
  streamInFlightRef: { current: boolean };
  nativeTurnStartAtRef: { current: number };
  lastUserRawRef: { current: string };
  activeDocumentAttachmentRef: { current: import("./hostMessage").LocalAttachment | null };
  onMiniappRef: { current: (miniapp: unknown) => void };
  memoryExtractRef: { current: Promise<void> | null };
  memoryExtractCancelRef: { current: (() => void) | null };
  toolhelpRef: { current: boolean };
  contextModeRef: { current: import("../context/compactor").ContextMode };
  compactionEnabledRef: { current: boolean };
  embedderDownloadedRef: { current: boolean };
  chatEngineCtxRef: { current: number };
  conversationsRef: { current: ConversationsState };
  flags: ReturnType<typeof useToolFlags>;
  memory: ReturnType<typeof useMemoryHost>;
  personas: ReturnType<typeof usePersonasHost>;
  library: ReturnType<typeof useLibraryHost>;
}

export function useHostEngine(params: HostEngineParams) {
  const {
    t,
    locale,
    thermalHardGateRef,
    thermalHardGated,
    setStreaming,
    streamInFlightRef,
    nativeTurnStartAtRef,
    lastUserRawRef,
    activeDocumentAttachmentRef,
    onMiniappRef,
    memoryExtractRef,
    memoryExtractCancelRef,
    toolhelpRef,
    contextModeRef,
    compactionEnabledRef,
    embedderDownloadedRef,
    chatEngineCtxRef,
    conversationsRef,
    flags,
    memory,
    personas,
    library,
  } = params;
  const agentOptions = useMemo(
    () =>
      buildAgentOptions(
        buildAgentDeps({
          locale,
          webToolsEnabled: flags.webToolsEnabled,
          deviceToolsEnabled: flags.deviceToolsEnabled,
          calendarToolsEnabled: flags.calendarToolsEnabled,
          webToolsEnabledRef: flags.flagRefs.webToolsEnabledRef,
          deviceToolsEnabledRef: flags.flagRefs.deviceToolsEnabledRef,
          calendarToolsEnabledRef: flags.flagRefs.calendarToolsEnabledRef,
          documentLibraryRef: library.documentLibraryRef,
          activeDocumentAttachmentRef,
          chatEngineCtxRef,
          embedderDownloadedRef,
          thermalHardGateRef,
          onMiniappRef,
          lastUserRawRef,
          toolhelpRef,
          injectedFactsRef: memory.injectedFactsRef,
        }),
      ),
    [
      locale,
      flags.webToolsEnabled,
      flags.deviceToolsEnabled,
      flags.calendarToolsEnabled,
    ],
  );
  const agentOptionsRef = useRef(agentOptions);
  agentOptionsRef.current = agentOptions;

  const modelHost = useModelHost({
    t,
    locale,
    thermalHardGated,
    thermalHardGateRef,
    streamInFlightRef,
    conversationsRef,
    agentOptions,
    agentOptionsRef,
    memoryExtractRef,
    embedderDownloadedRef,
    chatEngineCtxRef,
  });

  // The 180 s foreground-idle governor (PARITY-STATUS gap 8): mounted here
  // because this chain holds the turn refs the token-silence gate reads and
  // the model host that owns the chat-gate generation the discard releases.
  useForegroundIdleDispose({
    streamInFlightRef,
    nativeTurnStartAtRef,
    chatGateGenRef: modelHost.scanRefs.chatGateGenRef,
  });

  const turnDeps = buildTurnDeps(
    {
      conversationsRef,
      t,
      locale,
      thermalHardGateRef,
      thermalHardGated,
      setStreaming,
      streamInFlightRef,
      nativeTurnStartAtRef,
      lastUserRawRef,
      activeDocumentAttachmentRef,
      onMiniappRef,
      memoryExtractRef,
      memoryExtractCancelRef,
      memoryEnabledRef: memory.memoryEnabledRef,
      memoryFactsRef: memory.memoryFactsRef,
      injectedFactsRef: memory.injectedFactsRef,
      setMemoryFacts: memory.setMemoryFacts,
      refreshMemoryFacts: memory.refreshMemoryFacts,
      toolhelpRef,
      contextModeRef,
      compactionEnabledRef,
      documentLibraryRef: library.documentLibraryRef,
      embedderDownloadedRef,
      personasStateRef: personas.personasStateRef,
      activePersonaIdRef: personas.activePersonaIdRef,
      webToolsEnabled: flags.webToolsEnabled,
      deviceToolsEnabled: flags.deviceToolsEnabled,
      calendarToolsEnabled: flags.calendarToolsEnabled,
      webToolsEnabledRef: flags.flagRefs.webToolsEnabledRef,
      deviceToolsEnabledRef: flags.flagRefs.deviceToolsEnabledRef,
      calendarToolsEnabledRef: flags.flagRefs.calendarToolsEnabledRef,
      currentModel: modelHost.currentModel,
      ensureEngineForModelRef: modelHost.scanRefs.ensureEngineForModelRef,
      remoteErrorRef: modelHost.remoteErrorRef,
      chatEngineCtxRef,
      recordDecodeSample: modelHost.recordDecodeSample,
      agentOptions,
      agentOptionsRef,
    },
  );


  return { agentOptions, agentOptionsRef, modelHost, turnDeps };
}
