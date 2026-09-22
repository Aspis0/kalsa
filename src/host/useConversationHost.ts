/**
 * The conversations index: state, the 180 ms search debounce, the save FIFO,
 * `applyConversations`, `bindActiveConversation` and the boot load.
 *
 * Not lifted here: the three flush/empty/epoch REF slots the old parent held —
 * one root calls the history host's functions directly (same order, no refs
 * to register).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createEmptyConversationMeta,
  getDefaultConversationsStorage,
  loadConversationsState,
  messagesKey,
  saveConversationsState,
  type ConversationsState,
} from "../conversations/ConversationsStore";
import { getBootHistoryHash, setBootMessagesKey, setSessionConversationId, resetBootHistoryHash } from "../engine/sessionPersistence";

/** Search debounce in ms. */
const SEARCH_DEBOUNCE_MS = 180;

export function useConversationHost(): {
  conversations: ConversationsState;
  conversationsRef: { current: ConversationsState };
  conversationsReady: boolean;
  chatSearch: string;
  chatSearchQuery: string;
  handleChatSearchChange: (query: string) => void;
  clearChatSearch: () => void;
  applyConversations: (next: ConversationsState) => void;
  bindActiveConversation: (id: string) => void;
  newChatInFlightRef: { current: boolean };
} {
  const [conversations, setConversations] = useState<ConversationsState>({
    activeId: "",
    items: [],
  });
  const conversationsRef = useRef<ConversationsState>(conversations);
  conversationsRef.current = conversations;
  const [conversationsReady, setConversationsReady] = useState(false);
  const [chatSearch, setChatSearch] = useState("");
  const [chatSearchQuery, setChatSearchQuery] = useState("");
  const chatSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleChatSearchChange = useCallback((query: string) => {
    setChatSearch(query);
    if (chatSearchTimerRef.current !== null) clearTimeout(chatSearchTimerRef.current);
    if (!query) {
      setChatSearchQuery("");
      chatSearchTimerRef.current = null;
      return;
    }
    chatSearchTimerRef.current = setTimeout(() => {
      chatSearchTimerRef.current = null;
      setChatSearchQuery(query);
    }, SEARCH_DEBOUNCE_MS);
  }, []);
  useEffect(
    () => () => {
      if (chatSearchTimerRef.current !== null) clearTimeout(chatSearchTimerRef.current);
    },
    [],
  );
  const clearChatSearch = useCallback(() => handleChatSearchChange(""), [handleChatSearchChange]);
  const conversationsMutationRef = useRef(0);
  const pendingConversationSaveRef = useRef<Promise<void>>(Promise.resolve());
  const newChatInFlightRef = useRef(false);
  const enqueueConversationSave = useCallback((state: ConversationsState) => {
    const run = async () => {
      try {
        await saveConversationsState(getDefaultConversationsStorage(), state);
      } catch {
        // best-effort; queue must keep draining
      }
    };
    pendingConversationSaveRef.current = pendingConversationSaveRef.current
      .then(run, run)
      .catch(() => undefined);
  }, []);

  const applyConversations = useCallback(
    (next: ConversationsState) => {
      conversationsMutationRef.current += 1;
      conversationsRef.current = next;
      setConversations(next);
      enqueueConversationSave(next);
    },
    [enqueueConversationSave],
  );

  const bindActiveConversation = useCallback((id: string) => {
    if (!id) return;
    try {
      setBootMessagesKey(messagesKey(id));
    } catch {
      return;
    }
    setSessionConversationId(id);
    resetBootHistoryHash();
  }, []);

  useEffect(() => {
    let mounted = true;
    const loadGen = conversationsMutationRef.current;
    void loadConversationsState(getDefaultConversationsStorage())
      .then(async (loaded) => {
        if (!mounted) return;
        if (conversationsMutationRef.current !== loadGen) return;
        let state = loaded;
        if (state.items.length === 0) {
          const meta = createEmptyConversationMeta();
          state = { activeId: meta.id, items: [meta] };
          enqueueConversationSave(state);
        }
        if (!mounted) return;
        conversationsRef.current = state;
        setConversations(state);
        bindActiveConversation(state.activeId);
        void getBootHistoryHash();
        setConversationsReady(true);
      })
      .catch(() => {
        if (!mounted) return;
        const meta = createEmptyConversationMeta();
        const state: ConversationsState = { activeId: meta.id, items: [meta] };
        conversationsRef.current = state;
        setConversations(state);
        enqueueConversationSave(state);
        bindActiveConversation(state.activeId);
        void getBootHistoryHash();
        setConversationsReady(true);
      });
    return () => {
      mounted = false;
    };
  }, [bindActiveConversation, enqueueConversationSave]);
  return {
    conversations,
    conversationsRef,
    conversationsReady,
    chatSearch,
    chatSearchQuery,
    handleChatSearchChange,
    clearChatSearch,
    applyConversations,
    bindActiveConversation,
    newChatInFlightRef,
  };
}
