/**
 * The new root: the honest essential loop — real conversations behind the
 * owner's shell, a real send through the lifted engine half, the drawer,
 * the overlay union, the notice toast. `App.tsx` renders this behind
 * `NEW_SHELL`; the old branch is TEMPORARY, so `AppShell` still boots as the
 * controller until `docs/PARITY.md` says the rest is reproduced.
 *
 * The root may only COMPOSE: state it owns, hooks it calls, one layout it
 * renders (fileSize.test pins the line budget). The three children and their
 * arrangement live in `HostLayout.tsx` — the seam cut so new wiring lands
 * beside the root instead of pushing it back to its ceiling.
 */
import { useMemo, useState, useCallback } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { sendingInFlightRef } from "../engine/regenState";
import { getActiveModelId, isEngineReady, type EngineTool } from "../engine/LlamaService";
import { useLocale } from "../i18n";
import { useHostTurnRefs, type TouchedRef } from "./turnRefs";
import { useComposerArms } from "./composerArms";
import { useToolCapture } from "./toolCapture";
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
import { useMessageActions } from "./messageActions";
import { useHostEffects } from "./useHostEffects";
import { useNotice } from "./useNotice";
import { useAttachments } from "./useAttachments";
import { useShareIn } from "./useShareIn";
import { composerView } from "./composerView";
import { shareConversation } from "./shareConversation";
import { createTurnFence } from "./turnGuards";
import { HostLayout } from "./HostLayout";
import { withMiniappOverlay, type HostOverlay } from "./hostOverlay";

export function HostRoot() {
  const { t, locale } = useLocale();
  const insets = useSafeAreaInsets();
  const fence = useMemo(() => createTurnFence(), []);

  // ── Host-owned engine-turn state (the names the lifted halves read) ──
  // The ref cluster and the thermal gate live in `turnRefs.ts` — the seam cut
  // so the Web switch, the composer arms and the welcome wiring could land
  // without the root growing past its ratchet (the root may only compose).
  const { thermalHardGated, touchedRef, refs: turnRefs } = useHostTurnRefs();

  const [streaming, setStreaming] = useState(false);
  const [sending, setSending] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeOverlay, setActiveOverlay] = useState<HostOverlay>(null);
  const [draft, setDraft] = useState("");
  // The volatile tool rows (D1 row 23) — state + handlers in `toolCapture.ts`,
  // a seam cut so the attach flow could land under the root's line budget.
  const { toolsById, onToolCapture, clearTools } = useToolCapture();
  /** The research/notes one-shot arms (D1 row 14) — beside the draft they
   *  clear with; `sendHost` reads them through their refs. */  const arms = useComposerArms(draft);

  const flags = useToolFlags();
  const memory = useMemoryHost();
  const personas = usePersonasHost();
  const library = useLibraryHost(t);
  const conv = useConversationHost();

  const { agentOptions, modelHost, turnDeps } = useHostEngine({
    t,
    locale,
    thermalHardGated,
    setStreaming,
    // The thirteen turn refs, from the seam module.
    ...turnRefs,
    conversationsRef: conv.conversationsRef,
    flags,
    memory,
    personas,
    library,
  });

  // One-slot notice first: the attach flow's picker refusals speak through it.
  const { notice, showNotice, showNoticeKey } = useNotice();
  // The attach flow (D1 row 43): the rows, the live PDF conversion, the pickers.
  const attachments = useAttachments({ t, locale, showNotice, addDocument: library.addDocument, visionCapable: () => Boolean(modelHost.currentModel.mmproj) });

  const handleConversationEnter = useCallback(() => {
    setDraft("");
    clearTools();
    // Entering drops both arms AND the staged rows (controller `Chat:1887-1892`).
    arms.clear();
    attachments.clear();
  }, []);
  // Typed as the ref's own shape so the callback stays one line (ratchet).
  const onTouched = useCallback<NonNullable<TouchedRef["current"]>>((meta) => {
    touchedRef.current?.(meta);
  }, []);
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

  const clearDraft = useCallback(() => setDraft(""), []);

  // Share-in (D1 row 41): listener, pending flush, nonce merge — one hook,
  // ports only, now including the attach row a shared PDF lands in.
  useShareIn({ conversationsReady: conv.conversationsReady, setDraft, setDrawerOpen, showNoticeKey, addDocument: library.addDocument, attachDocument: attachments.addLibraryDocumentRow });
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
    draft,
    showNoticeKey,
    arms,
    attachments,
    visionCapable: Boolean(modelHost.currentModel.mmproj),
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

  // The message interactions (PARITY-STATUS gap 1): the long-press menu,
  // copy, translate, edit-then-resend, read-aloud — implementations in
  // `messageActions.ts` and its files, live pieces here as ports.
  const messageActions = useMessageActions({
    t,
    locale,
    sending,
    sendHost,
    history,
    showNoticeKey,
    conversationId: conv.conversationsReady ? conv.conversations.activeId : undefined,
    ttsEnabled: modelHost.scans.ttsEnabled,
  });

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
    // Translate holds the engine (`Chat:3605`): the face dims here, the
    // send itself refuses in `sendHost.send`.
    translating: messageActions.translating,
    modelState: modelHost.modelState,
    engineResident:
      isEngineReady() && getActiveModelId() === modelHost.currentModel.id,
    attachments: attachments.items,
    converting: attachments.converting !== null,
  });

  const size = { top: insets.top, bottom: insets.bottom };

  return (
    <HostLayout
      insets={size}
      draft={draft}
      onDraftChange={setDraft}
      view={view}
      modelHost={modelHost}
      showNoticeKey={showNoticeKey}
      sendHost={sendHost}
      onMenuPress={() => setDrawerOpen(true)}
      onNewChatPress={() => actions.handleNewConversation()}
      flags={flags}
      arms={arms}
      attachments={attachments}
      actions={messageActions}
      onMiniappOpen={(miniapp) => setActiveOverlay((previous) => withMiniappOverlay(previous, miniapp))}
      drawerOpen={drawerOpen}
      setDrawerOpen={setDrawerOpen}
      conv={conv}
      conversationActions={actions}
      personas={personas}
      onExportPress={() => shareConversation(history.messages, t)}
      activeOverlay={activeOverlay}
      setActiveOverlay={setActiveOverlay}
      notice={notice}
      showNotice={showNotice}
      memory={memory}
      library={library}
      streaming={streaming}
    />
  );
}
