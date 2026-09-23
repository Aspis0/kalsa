/**
 * Conversation actions — the ordering-critical set the parity doc marks
 * D2 row 13: switch (flush before bind, UI-first so the session stem stays
 * on the chat being left), new (idle-thread reuse), delete (index before
 * key; the ACTIVE key delete runs behind `bumpEpoch`, injected here), touch,
 * the confirm dialog and the two drawer item builders.
 *
 * Adaptations (reported): the parent↔child flush/empty/epoch ref slots
 * become direct calls (`flushPartial` / `isActiveChatEmpty` /
 * `bumpPersistEpoch`) — one root needs no registration dance; the
 * `useCallback`/`useMemo` wrappers become plain functions.
 */
import { Alert, Keyboard } from "react-native";
import {
  FileText as LucideFileText,
  Settings as LucideSettings,
  StickyNote as LucideStickyNote,
  UserCircle as LucideUserCircle,
} from "lucide-react-native";
import {
  conversationHasPersistedMessages,
  createEmptyConversationMeta,
  getDefaultConversationsStorage,
  messagesKey,
  removeConversation,
  setActive,
  upsertMeta,
  type ConversationsState,
} from "../conversations/ConversationsStore";
import {
  computeHistoryHashFromMessages,
  readBootMessages,
} from "../engine/sessionPersistence";
import {
  getActiveModelId,
  invalidateConversationSessions,
  isEngineReady,
  restoreEngineSession,
  saveEngineSession,
} from "../engine/LlamaService";
import { deleteConversationHistory } from "../chat/historyQuarantine";
import { resetCompactorChat } from "./turnCorpus";
import type { TranslateFn } from "../i18n";
import type { DrawerConversationItem, DrawerItem } from "../theme/components/Drawer";
import type { HostOverlay } from "./hostOverlay";
import { buildDrawerConversationItems } from "./conversationRowActions";

export interface ConversationActionCtx {
  t: TranslateFn;
  conversationsRef: { current: ConversationsState };
  applyConversations: (next: ConversationsState) => void;
  bindActiveConversation: (id: string) => void;
  clearChatSearch: () => void;
  /** Flush the active thread's last write. */
  flushPartial: () => void;
  /** True when the active chat is empty. */
  isActiveChatEmpty: () => boolean;
  /** Bump the history epoch BEFORE an active key delete. */
  bumpPersistEpoch: () => void;
  sendingInFlightRef: { current: boolean };
  setDrawerOpen: (open: boolean) => void;
  setActiveOverlay: (overlay: HostOverlay) => void;
}

export function createConversationActions(ctx: ConversationActionCtx) {
  const {
    t,
    conversationsRef,
    applyConversations,
    bindActiveConversation,
    clearChatSearch,
    flushPartial,
    isActiveChatEmpty,
    bumpPersistEpoch,
    sendingInFlightRef,
    setDrawerOpen,
    setActiveOverlay,
  } = ctx;
/** Module singleton on purpose: the guard must survive re-renders (single root). */
const newChatInFlightRef = { current: false };
  function handleSwitchConversation(id: string): void {
      if (!id) return;
      clearChatSearch();
      if (id === conversationsRef.current.activeId) {
        setDrawerOpen(false);
        return;
      }
      flushPartial();
      setDrawerOpen(false);
      const modelId = getActiveModelId();
      // UI first. Keep sessionConversationId on the chat we are leaving so
      // saveEngineSession still writes that stem; bind after save.
      applyConversations(setActive(conversationsRef.current, id));
      void (async () => {
        if (modelId && isEngineReady() && !sendingInFlightRef.current) {
          try {
            const msgs = await readBootMessages();
            await saveEngineSession(
              modelId,
              computeHistoryHashFromMessages(msgs),
              msgs.length,
            );
          } catch {
            // previous good .kvs stays if save skips/fails
          }
        }
        bindActiveConversation(id);
        if (modelId) {
          try {
            await restoreEngineSession(modelId);
          } catch {
            // miss → cold prefill on next send
          }
        }
      })();
  }

  function handleNewConversation(): void {
    clearChatSearch();
    if (isActiveChatEmpty()) {
      setDrawerOpen(false);
      return;
    }
    if (newChatInFlightRef.current) {
      setDrawerOpen(false);
      return;
    }
    flushPartial();
    newChatInFlightRef.current = true;
    void (async () => {
      try {
        const storage = getDefaultConversationsStorage();
        const currentId = conversationsRef.current.activeId;
        for (const item of conversationsRef.current.items) {
          if (item.id === currentId) continue;
          let occupied = item.hasMessages;
          if (occupied !== true && occupied !== false) {
            try {
              occupied = await conversationHasPersistedMessages(storage, item.id);
            } catch {
              occupied = false;
            }
          }
          if (!occupied) {
            handleSwitchConversation(item.id);
            return;
          }
        }
        if (isActiveChatEmpty()) {
          setDrawerOpen(false);
          return;
        }
        const meta = createEmptyConversationMeta();
        const modelId = getActiveModelId();
        if (modelId && isEngineReady() && !sendingInFlightRef.current) {
          try {
            const msgs = await readBootMessages();
            await saveEngineSession(
              modelId,
              computeHistoryHashFromMessages(msgs),
              msgs.length,
            );
          } catch {
            // previous good .kvs stays
          }
        }
        applyConversations(setActive(upsertMeta(conversationsRef.current, meta), meta.id));
        bindActiveConversation(meta.id);
        setDrawerOpen(false);
      } finally {
        newChatInFlightRef.current = false;
      }
    })();
  }

  function handleDeleteConversation(id: string): void {
      if (!id) return;
      const prev = conversationsRef.current;
      if (!prev.items.some((item) => item.id === id)) return;
      clearChatSearch();
      const deletingActive = prev.activeId === id;
      void resetCompactorChat(id);
      let next = removeConversation(prev, id);
      if (next.items.length === 0) {
        const meta = createEmptyConversationMeta();
        next = { activeId: meta.id, items: [meta] };
      }
      applyConversations(next);
      try {
        // The quarantine key holds the full raw conversation text and
        // nothing garbage-collects it: it must not outlive the delete.
        void deleteConversationHistory(
          getDefaultConversationsStorage(),
          messagesKey(id),
        )
          .then((complete) => {
            // The sweep could not run: some slot may survive the delete.
            if (!complete) {
              console.warn("[historyGuard] conversation delete incomplete");
            }
          })
          .catch(() => {
            // A rejected removal must not become an unhandled rejection; the
            // slots go first, so the raw at least never survives as a copy.
            console.warn("[historyGuard] conversation delete incomplete");
          });
      } catch {
        // ignore illegal id
      }
      void invalidateConversationSessions(id);
      if (deletingActive) {
        bumpPersistEpoch();
        bindActiveConversation(next.activeId);
        const modelId = getActiveModelId();
        if (modelId) void restoreEngineSession(modelId);
      }
      setDrawerOpen(false);
  }

  function confirmDeleteConversation(id: string): void {
      Alert.alert(t("drawer.deleteChat"), t("drawer.deleteChatConfirm"), [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("drawer.deleteChat"),
          style: "destructive",
          onPress: () => handleDeleteConversation(id),
        },
      ]);
  }

  function handleConversationTouched(meta: { title: string; preview: string; searchBlob: string }): void {
      const id = conversationsRef.current.activeId;
      if (!id) return;
      const existing = conversationsRef.current.items.find((item) => item.id === id);
      applyConversations(
        upsertMeta(conversationsRef.current, {
          id,
          title: meta.title || existing?.title || "",
          updatedAt: Date.now(),
          preview: meta.preview,
          searchBlob: meta.searchBlob,
          hasMessages: true,
        }),
      );
  }

  function drawerConversationItems(
    conversations: ConversationsState,
    chatSearchQuery: string,
    onActionSheetOpen: (id: string) => void,
    onExportPress: (id: string) => void,
  ): DrawerConversationItem[] {
    return buildDrawerConversationItems(
      conversations,
      chatSearchQuery,
      t("drawer.untitled"),
      t,
      handleSwitchConversation,
      onActionSheetOpen,
      onExportPress,
      confirmDeleteConversation,
    );
  }

  function drawerItems(): DrawerItem[] {
    return [
      {
        id: "settings",
        label: t("common.settings"),
        Icon: LucideSettings,
        onPress: () => {
          Keyboard.dismiss();
          clearChatSearch();
          setDrawerOpen(false);
          // Opening settings replaces any open miniapp (exclusive overlay).
          setActiveOverlay({ kind: "settings" });
        },
      },
      {
        id: "account",
        label: t("drawer.account"),
        Icon: LucideUserCircle,
        onPress: () => {
          Keyboard.dismiss();
          clearChatSearch();
          setDrawerOpen(false);
          setActiveOverlay({ kind: "account" });
        },
      },
      {
        id: "documents",
        label: t("documents.title"),
        Icon: LucideFileText,
        onPress: () => {
          Keyboard.dismiss();
          clearChatSearch();
          setDrawerOpen(false);
          setActiveOverlay({ kind: "documents" });
        },
      },
      {
        id: "notes",
        label: t("notes.title"),
        Icon: LucideStickyNote,
        onPress: () => {
          Keyboard.dismiss();
          clearChatSearch();
          setDrawerOpen(false);
          setActiveOverlay({ kind: "notes" });
        },
      },
    ];
  }

  return {
    handleSwitchConversation,
    handleNewConversation,
    handleDeleteConversation,
    confirmDeleteConversation,
    handleConversationTouched,
    drawerConversationItems,
    drawerItems,
  };
}
