/**
 * The new root: the honest essential loop — real conversations behind the
 * owner's shell, a real send through the lifted engine half, the drawer,
 * the overlay union, the notice toast.
 *
 * Everything under `src/host` is either lifted from the two controller
 * files (with the adaptation named at the lift) or composed on slice 1's
 * pinned seams. `App.tsx` renders this behind `NEW_SHELL`; the flag and old
 * branch are TEMPORARY, so `AppShell` still boots as the controller until
 * `docs/PARITY.md` says the rest is reproduced.
 *
 * The root may only COMPOSE: state it owns, hooks it calls, children it
 * arranges (`src/host/fileSize.test.ts` pins the line budget): strip/composer
 * are `HostChatSurface`, the drawer `HostDrawer`, overlays+notice `HostFurniture`.
 */
import { useMemo, useState, useCallback } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { sendingInFlightRef } from "../engine/regenState";
import { getActiveModelId, isEngineReady, type EngineTool } from "../engine/LlamaService";
import { useLocale } from "../i18n";
import { useHostTurnRefs } from "./turnRefs";
import { useComposerArms } from "./composerArms";
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
import { shareConversation } from "./shareConversation";
import { createTurnFence } from "./turnGuards";
import { HostChatSurface } from "./HostChatSurface";
import { HostDrawer } from "./HostDrawer";
import { HostFurniture } from "./HostFurniture";
import type { HostOverlay } from "./hostOverlay";

export function HostRoot() {
  const { t, locale } = useLocale();
  const insets = useSafeAreaInsets();
  const fence = useMemo(() => createTurnFence(), []);

  // ── Host-owned engine-turn state (the names the lifted halves read) ──
  // The ref cluster and the thermal gate live in `turnRefs.ts` — the seam cut
  // so the Web switch, the composer arms and the welcome wiring could land
  // without the root growing (the root may only compose; fileSize ratchet).
  const { thermalHardGated, touchedRef, refs: turnRefs } = useHostTurnRefs();

  const [streaming, setStreaming] = useState(false);
  const [sending, setSending] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeOverlay, setActiveOverlay] = useState<HostOverlay>(null);
  const [draft, setDraft] = useState("");
  const [toolsById, setToolsById] = useState<ReadonlyMap<string, { name: string }[]>>(new Map());
  /** The research/notes one-shot arms (D1 row 14): beside the draft they
   *  clear with, read by `sendHost` through their refs. */
  const arms = useComposerArms(draft);

  const flags = useToolFlags();
  const memory = useMemoryHost();
  const personas = usePersonasHost();
  const library = useLibraryHost(t);
  const conv = useConversationHost();

  const { agentOptions, agentOptionsRef, modelHost, turnDeps } = useHostEngine({
    t,
    locale,
    thermalHardGated,
    setStreaming,
    // The thirteen turn refs, from the seam module (was thirteen lines here).
    ...turnRefs,
    conversationsRef: conv.conversationsRef,
    flags,
    memory,
    personas,
    library,
  });

  const handleConversationEnter = useCallback(() => {
    setDraft("");
    setToolsById(new Map());
    // Old `AiChatPage:1894-1897`: entering a conversation drops both arms.
    arms.clear();
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
    arms,
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

  const size = { top: insets.top, bottom: insets.bottom };

  return (
    <View style={{ flex: 1 }}>
      <HostChatSurface
        insets={size}
        draft={draft}
        onDraftChange={setDraft}
        view={view}
        modelHost={modelHost}
        showNoticeKey={showNoticeKey}
        sendHost={sendHost}
        onMenuPress={() => setDrawerOpen(true)}
        onNewChatPress={() => actions.handleNewConversation()}
        onExportPress={() => shareConversation(history.messages, t)}
        flags={flags}
        arms={arms}
      />

      <HostDrawer
        insets={size}
        open={drawerOpen}
        setOpen={setDrawerOpen}
        conv={conv}
        actions={actions}
        personas={personas}
        setActiveOverlay={setActiveOverlay}
      />

      <HostFurniture
        overlay={activeOverlay}
        setOverlay={setActiveOverlay}
        onNotice={showNoticeKey}
        notice={notice}
        memory={memory}
        flags={flags}
        library={library}
        personas={personas}
        modelHost={modelHost}
        streaming={streaming}
      />
    </View>
  );
}
