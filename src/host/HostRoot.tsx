/**
 * The new root: the honest essential loop — real conversations behind the
 * owner's shell, a real send through the lifted engine half, the drawer,
 * the overlay union, the notice toast.
 *
 * Everything under `src/host` is either lifted from the two controller
 * files (with the adaptation named at the lift) or composed on slice 1's
 * pinned seams. `App.tsx` renders this behind `NEW_SHELL`; the flag and the
 * old branch are TEMPORARY and exist so `AppShell` can boot as the
 * controller until `docs/PARITY.md` says the rest is reproduced.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { isEmbedderHung } from "../engine/EmbeddingService";
import { getActiveModelId, isEngineReady, type EngineTool } from "../engine/LlamaService";
import { sendingInFlightRef } from "../engine/regenState";
import { type ContextMode } from "../context/compactor";
import { COMPACTION_ENABLED_DEFAULT } from "../engine/ttftFlags";
import { findPersona } from "../conversations/PersonasStore";
import { builtinCopyFromT } from "../screens/PersonasScreen";
import { Drawer } from "../theme/components";
import { useLocale } from "../i18n";
import { useLabTheme } from "../ui/labTheme";
import { useThermalHardGate } from "../hooks/useThermalHardGate";
import { useKeyboardHeight } from "../ui/shell/useKeyboardHeight";
import { bottomInsetFor, STRIP_HEIGHT } from "../ui/shell/shellGeometry";
import { Shell } from "../ui/shell/Shell";
import { Transcript } from "../ui/shell/Transcript";
import type { ThemeMode } from "../theme/design";
import { useToolFlags } from "./toolFlags";
import { useHostEngine } from "./useHostEngine";
import { useMemoryHost } from "./memoryHost";
import { usePersonasHost } from "./personasHost";
import { useLibraryHost } from "./libraryHost";
import { useConversationHost } from "./useConversationHost";
import { createConversationActions } from "./conversationActions";
import { useHistoryHost } from "./useHistoryHost";
import { useHistoryFlushes } from "./useHistoryFlushes";
import { useSendHost } from "./sendHost";
import { useHostEffects } from "./useHostEffects";
import { useNotice } from "./useNotice";
import { composerView } from "./composerView";
import { createTurnFence } from "./turnGuards";
import { HostNotice } from "./HostNotice";
import { HostOverlays } from "./HostOverlays";
import type { HostOverlay } from "./hostOverlay";

export function HostRoot() {
  const { mode } = useLabTheme<{ mode: ThemeMode }>();
  const { t, locale } = useLocale();
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  const fence = useMemo(() => createTurnFence(), []);

  // ── Host-owned engine-turn state (the names the lifted halves read) ──
  const thermalHardGateRef = useRef(false);
  const onThermalHardGateChange = useCallback((gated: boolean) => {
    // Native events update the imperative guard before React paints the gate.
    thermalHardGateRef.current = gated;
  }, []);
  const { gated: thermalHardGated } = useThermalHardGate({ onGateChange: onThermalHardGateChange });
  const streamInFlightRef = useRef(false);
  const nativeTurnStartAtRef = useRef(0);
  const memoryExtractRef = useRef<Promise<void> | null>(null);
  const memoryExtractCancelRef = useRef<(() => void) | null>(null);
  const lastUserRawRef = useRef("");
  const activeDocumentAttachmentRef = useRef<import("./hostMessage").LocalAttachment | null>(null);
  const onMiniappRef = useRef<(miniapp: unknown) => void>(() => {});
  const toolhelpRef = useRef(false);
  const contextModeRef = useRef<ContextMode>("anchored");
  const compactionEnabledRef = useRef(COMPACTION_ENABLED_DEFAULT);
  const embedderDownloadedRef = useRef(false);
  const chatEngineCtxRef = useRef(4096);
  const touchedRef = useRef<((meta: { title: string; preview: string; searchBlob: string }) => void) | null>(null);

  const [streaming, setStreaming] = useState(false);
  const [sending, setSending] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeOverlay, setActiveOverlay] = useState<HostOverlay>(null);
  const [draft, setDraft] = useState("");
  const [toolsById, setToolsById] = useState<ReadonlyMap<string, { name: string }[]>>(
    new Map(),
  );

  const flags = useToolFlags();
  const memory = useMemoryHost();
  const personas = usePersonasHost();
  const library = useLibraryHost(t);
  const conv = useConversationHost();

  const { agentOptions, agentOptionsRef, modelHost, turnDeps } = useHostEngine({
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
    conversationsRef: conv.conversationsRef,
    flags,
    memory,
    personas,
    library,
  });

  const handleConversationEnter = useCallback(() => {
    setDraft("");
    setToolsById(new Map());
  }, []);
  const onTouched = useCallback(
    (meta: { title: string; preview: string; searchBlob: string }) => {
      touchedRef.current?.(meta);
    },
    [],
  );
  const history = useHistoryHost({
    t,
    locale,
    conversationId: conv.conversationsReady ? conv.conversations.activeId : undefined,
    onConversationEnter: handleConversationEnter,
    onConversationTouched: onTouched,
  });

  const actions = createConversationActions({
    t,
    conversationsRef: conv.conversationsRef,
    applyConversations: conv.applyConversations,
    bindActiveConversation: conv.bindActiveConversation,
    clearChatSearch: conv.clearChatSearch,
    flushPartial: history.flushPartial,
    isActiveChatEmpty: history.isActiveChatEmpty,
    bumpPersistEpoch: () => history.writer.bumpEpoch(),
    sendingInFlightRef,
    setDrawerOpen,
    setActiveOverlay,
  });
  touchedRef.current = actions.handleConversationTouched;

  const onToolCapture = useCallback((assistantId: string, name: string) => {
    setToolsById((prev) => {
      const rows = prev.get(assistantId) ?? [];
      return new Map(prev).set(assistantId, [...rows, { name }]);
    });
  }, []);
  const clearDraft = useCallback(() => setDraft(""), []);
  const clearTools = useCallback(() => setToolsById(new Map()), []);

  const sendHost = useSendHost({
    t,
    fence,
    engineDeps: turnDeps,
    messagesRef: history.messagesRef,
    setMessages: history.setMessages,
    historyLoadedRef: history.historyLoadedRef,
    persist: history.persistActiveMessages,
    getEpoch: () => history.writer.epoch(),
    onSendingChange: setSending,
    onToolCapture,
    clearDraft,
  });

  useHistoryFlushes({
    messages: history.messages,
    messagesRef: history.messagesRef,
    historyLoaded: history.historyLoaded,
    sendingRef: sendHost.sendingRef,
    writer: history.writer,
    persistActiveMessages: history.persistActiveMessages,
    notifyConversationTouched: history.notifyConversationTouched,
  });

  useHostEffects({
    fence,
    conversationId: conv.conversationsReady ? conv.conversations.activeId : undefined,
    locale,
    webToolsEnabled: flags.webToolsEnabled,
    deviceToolsEnabled: flags.deviceToolsEnabled,
    calendarToolsEnabled: flags.calendarToolsEnabled,
    tools: agentOptions.tools as EngineTool[],
    abortRef: sendHost.abortRef,
    stopWatchdogRef: sendHost.stopWatchdogRef,
    sendingRef: sendHost.sendingRef,
    stopRequestedRef: sendHost.stopRequestedRef,
    flushPartial: history.flushPartial,
    setSending,
    clearTools,
  });

  const { notice, showNoticeKey } = useNotice();

  const view = composerView({
    messages: history.messages,
    toolsById,
    draft,
    thinkingStatus: t("chat.thinkingStatus"),
    historyLoaded: history.historyLoaded,
    thermalGated: thermalHardGated,
    sending,
    stopping: sendHost.stopRequestedRef.current,
    hasTokens: sendHost.hasTokensRef.current,
    modelState: modelHost.modelState,
    engineResident:
      isEngineReady() && getActiveModelId() === modelHost.currentModel.id,
  });

  // Strip pill, old chip semantics (AppShell:6879-6911): load when the bundle
  // is on disk but unloaded, retry an engine error, no-op while busy or
  // already resident (the old chip was disabled there); a missing bundle has
  // no download path in this build and says so (§2.7).
  const onModelPress = () => {
    if (isEmbedderHung()) return;
    const resident = isEngineReady() && getActiveModelId() === modelHost.currentModel.id;
    if (modelHost.modelState === "missing" || modelHost.modelErrorKind === "download") {
      showNoticeKey("shell.notice.download");
      return;
    }
    if (modelHost.modelState === "checking" || modelHost.modelState === "loading") return;
    if (modelHost.modelState === "ready" && resident) return;
    modelHost.userReloadModel(modelHost.currentModel);
  };

  const size = { top: insets.top, bottom: insets.bottom };
  const bandInsets = bottomInsetFor(size, keyboardHeight);

  return (
    <View style={{ flex: 1 }}>
      <Shell
        insets={size}
        modelName={modelHost.currentModel.name}
        whereLabel={t("shell.where.thisPhone")}
        keyboardHeight={keyboardHeight}
        mode={mode}
        draft={draft}
        onDraftChange={setDraft}
        editable={view.composer.field.editable}
        placeholderKey={view.composer.field.placeholder ?? undefined}
        holdReason={view.composer.hold === null ? null : t(view.composer.hold)}
        face={view.composer.face}
        faceLabel={t(view.composer.faceLabel)}
        faceEnabled={view.composer.faceEnabled}
        sendEnabled={view.sendEnabled}
        onMenuPress={() => setDrawerOpen(true)}
        onModelPress={onModelPress}
        onNewChatPress={() => actions.handleNewConversation()}
        onAttachPress={() => showNoticeKey("shell.notice.attach")}
        onMicPress={() => showNoticeKey("shell.notice.mic")}
        onSendPress={() => {
          if (view.composer.face === "stop") sendHost.stop();
          else void sendHost.send(draft);
        }}
      >
        <Transcript
          insets={bandInsets}
          messages={view.transcript}
          mode={mode}
        />
      </Shell>

      <Drawer
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          conv.clearChatSearch();
        }}
        brand="Kalsa"
        subtitle={t("drawer.subtitle")}
        items={actions.drawerItems()}
        conversationItems={actions.drawerConversationItems(
          conv.conversations,
          conv.chatSearchQuery,
        )}
        searchValue={conv.chatSearch}
        searchQuery={conv.chatSearchQuery}
        onSearchChange={conv.handleChatSearchChange}
        onNewChat={() => actions.handleNewConversation()}
        personaLabel={
          findPersona(personas.personasState, personas.activePersonaId, builtinCopyFromT(t))
            ?.name ?? t("drawer.personaNone")
        }
        modelBarHeight={insets.top + STRIP_HEIGHT}
        onPersonaPress={() => {
          setDrawerOpen(false);
          conv.clearChatSearch();
          setActiveOverlay({ kind: "personas" });
        }}
      />

      <HostOverlays
        overlay={activeOverlay}
        setOverlay={setActiveOverlay}
        onNotice={showNoticeKey}
        refreshMemoryFacts={memory.refreshMemoryFacts}
        refreshToolFlags={flags.refreshToolFlags}
        refreshContextSize={modelHost.refreshContextSize}
        currentModel={modelHost.currentModel}
        modelState={modelHost.modelState}
        modelError={modelHost.modelError}
        modelErrorDetail={modelHost.modelErrorDetail}
        modelErrorKind={modelHost.modelErrorKind}
        deviceBandwidth={modelHost.deviceBandwidth}
        streaming={streaming}
        selectModelById={modelHost.selectModelById}
        userReloadModel={modelHost.userReloadModel}
        voiceState={modelHost.scans.voiceState}
        ttsEnabled={modelHost.scans.ttsEnabled}
        setTtsEnabled={modelHost.scans.setTtsEnabled}
        embeddingState={modelHost.scans.embeddingState}
        library={library.library}
        addDocument={library.addDocument}
        deleteDocument={library.deleteDocument}
        reorderDocuments={library.reorderDocuments}
        updateDocumentPreview={library.updateDocumentPreview}
        isDocumentDeleteInFlight={library.isDocumentDeleteInFlight}
        setActivePersonaId={personas.setActivePersonaId}
        refreshPersonas={personas.refreshPersonas}
      />

      <HostNotice text={notice} />
    </View>
  );
}
